from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from anyio import to_thread
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.requests import Request

from app.services.ticket_provider_12306 import TicketProvider12306
from app.services.transfer_optimizer import find_best_transfer_plan


BASE_DIR = Path(__file__).resolve().parent
TEMPLATES = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class SearchRequest(BaseModel):
    travel_date: date
    departure_station: str
    arrival_station: str


class SearchService:
    def __init__(self, provider) -> None:
        self.provider = provider

    def search(self, payload: SearchRequest) -> list[dict]:
        trips = self.provider.search_trips(payload.travel_date, payload.departure_station, payload.arrival_station)
        best_plan = find_best_transfer_plan(
            trips=trips,
            departure_station=payload.departure_station,
            arrival_station=payload.arrival_station,
            min_transfer_minutes=20,
        )
        if best_plan is None:
            return []
        return [best_plan.to_dict()]



def create_app(provider=None) -> FastAPI:
    provider_instance = provider or TicketProvider12306()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
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

    @app.post("/api/search")
    async def search(payload: SearchRequest):
        plans = await to_thread.run_sync(service.search, payload)
        return {"plans": plans}

    return app


app = create_app()
