from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from anyio import to_thread
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.requests import Request

from app.services.ticket_provider_12306 import TicketProvider12306
from app.services.transfer_optimizer import find_transfer_plans


BASE_DIR = Path(__file__).resolve().parent
TEMPLATES = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class SearchRequest(BaseModel):
    travel_date: date
    departure_station: str
    arrival_station: str


class InvalidStationError(ValueError):
    pass


class UpstreamTicketError(RuntimeError):
    pass


class SearchService:
    def __init__(self, provider) -> None:
        self.provider = provider

    def list_stations(self, query: str, limit: int) -> list[dict[str, str]]:
        return self.provider.list_stations(query=query, limit=limit)

    def list_cities(self, query: str, limit: int) -> list[dict]:
        return self.provider.list_cities(query=query, limit=limit)

    def search(self, payload: SearchRequest) -> dict:
        if not self.provider.has_station(payload.departure_station) or not self.provider.has_station(payload.arrival_station):
            raise InvalidStationError
        try:
            trips = self.provider.search_trips(payload.travel_date, payload.departure_station, payload.arrival_station)
        except httpx.HTTPError as error:
            raise UpstreamTicketError from error
        plans, recommendations = find_transfer_plans(
            trips=trips,
            departure_station=payload.departure_station,
            arrival_station=payload.arrival_station,
            min_transfer_minutes=20,
        )
        return {
            "plans": [plan.to_dict() for plan in plans],
            "recommendations": {key: plan.to_dict() for key, plan in recommendations.items()},
        }



def create_app(provider=None) -> FastAPI:
    provider_instance = provider or TicketProvider12306()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        load_station_codes = getattr(provider_instance, "load_station_codes", None)
        if callable(load_station_codes):
            await to_thread.run_sync(load_station_codes)
        yield
        close = getattr(provider_instance, "close", None)
        if callable(close):
            close()

    app = FastAPI(title="火车票最优购买方案", lifespan=lifespan)
    service = SearchService(provider_instance)

    app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

    @app.get("/", response_class=HTMLResponse)
    async def home(request: Request):
        return TEMPLATES.TemplateResponse(request, "index.html", {})

    @app.get("/api/stations")
    async def stations(q: str = "", limit: int = Query(default=20, ge=1, le=50)):
        stations_payload = await to_thread.run_sync(service.list_stations, q, limit)
        return {"stations": stations_payload}

    @app.get("/api/cities")
    async def cities(q: str = "", limit: int = Query(default=20, ge=1, le=50)):
        cities_payload = await to_thread.run_sync(service.list_cities, q, limit)
        return {"cities": cities_payload}

    @app.post("/api/search")
    async def search(payload: SearchRequest):
        try:
            return await to_thread.run_sync(service.search, payload)
        except InvalidStationError as error:
            raise HTTPException(status_code=400, detail="请选择有效的 12306 站点") from error
        except UpstreamTicketError as error:
            raise HTTPException(status_code=502, detail="12306 暂时无法返回有效余票数据，请稍后重试") from error

    return app


app = create_app()
