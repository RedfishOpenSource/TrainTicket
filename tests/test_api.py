from fastapi.testclient import TestClient

from app.main import create_app
from app.models.domain import SeatOption, TrainStop, TrainTrip


class FakeProvider:
    def __init__(self):
        self.stations = [
            {"name": "西安", "telecode": "XAY", "pinyin": "xian", "abbr": "xa"},
            {"name": "十堰", "telecode": "SNN", "pinyin": "shiyan", "abbr": "sy"},
            {"name": "大同", "telecode": "DTV", "pinyin": "datong", "abbr": "dt"},
        ]

    def list_stations(self, query="", limit=20):
        return [station for station in self.stations if query.lower() in station["name"].lower() or query.lower() in station["pinyin"]][:limit]

    def has_station(self, station_name):
        return any(station["name"] == station_name for station in self.stations)

    def search_trips(self, travel_date, departure_station, arrival_station):
        from datetime import datetime

        return [
            TrainTrip(
                train_number="K1",
                train_code="K1",
                stops=[
                    TrainStop(name="大同", arrive_at=None, depart_at=datetime(2026, 4, 30, 8, 0)),
                    TrainStop(name="西安", arrive_at=datetime(2026, 5, 1, 8, 0), depart_at=datetime(2026, 5, 1, 8, 5)),
                    TrainStop(name="十堰", arrive_at=datetime(2026, 5, 1, 12, 0), depart_at=None),
                ],
                seat_inventory={
                    (0, 2): [SeatOption(seat_type="硬卧", price=260.0, available=True)],
                    (1, 2): [SeatOption(seat_type="硬座", price=120.0, available=False)],
                },
            )
        ]



def test_home_page_renders_form():
    client = TestClient(create_app(provider=FakeProvider()))

    response = client.get("/")

    assert response.status_code == 200
    assert "火车票最优购买方案" in response.text
    assert "出发城市" in response.text
    assert "智能购票引擎" in response.text
    assert "推荐结果" in response.text



def test_search_endpoint_returns_ranked_plans():
    client = TestClient(create_app(provider=FakeProvider()))

    response = client.post(
        "/api/search",
        json={"travel_date": "2026-05-01", "departure_station": "西安", "arrival_station": "十堰"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["plans"][0]["strategy"] == "buy_longer"
    assert payload["plans"][0]["total_travel_minutes"] == 235
    assert payload["plans"][0]["segments"][0]["board_station"] == "大同"
    assert payload["recommendations"]["shortest_duration"]["strategy"] == "buy_longer"
    assert payload["recommendations"]["cheapest_price"]["strategy"] == "buy_longer"
    assert payload["recommendations"]["sleeper_priority"]["strategy"] == "buy_longer"



def test_search_endpoint_returns_empty_when_only_later_boarding_segments_have_inventory():
    class LaterBoardingOnlyProvider:
        def list_stations(self, query="", limit=20):
            return [
                {"name": "西安", "telecode": "XAY", "pinyin": "xian", "abbr": "xa"},
                {"name": "十堰", "telecode": "SNN", "pinyin": "shiyan", "abbr": "sy"},
            ][:limit]

        def has_station(self, station_name):
            return station_name in {"西安", "十堰"}

        def search_trips(self, travel_date, departure_station, arrival_station):
            from datetime import datetime

            return [
                TrainTrip(
                    train_number="K2098",
                    train_code="K2098",
                    stops=[
                        TrainStop(name="西安", arrive_at=None, depart_at=datetime(2026, 5, 1, 8, 0)),
                        TrainStop(name="安康", arrive_at=datetime(2026, 5, 1, 10, 0), depart_at=datetime(2026, 5, 1, 10, 5)),
                        TrainStop(name="十堰", arrive_at=datetime(2026, 5, 1, 12, 0), depart_at=None),
                        TrainStop(name="长沙", arrive_at=datetime(2026, 5, 1, 18, 0), depart_at=None),
                    ],
                    seat_inventory={
                        (0, 2): [SeatOption(seat_type="硬座", price=120.0, available=False)],
                        (1, 2): [SeatOption(seat_type="无座", price=32.5, available=True)],
                    },
                )
            ]

    client = TestClient(create_app(provider=LaterBoardingOnlyProvider()))

    response = client.post(
        "/api/search",
        json={"travel_date": "2026-05-01", "departure_station": "西安", "arrival_station": "十堰"},
    )

    assert response.status_code == 200
    assert response.json() == {"plans": [], "recommendations": {}}



def test_station_endpoint_returns_search_matches():
    client = TestClient(create_app(provider=FakeProvider()))

    response = client.get("/api/stations", params={"q": "xi", "limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["stations"][0]["name"] == "西安"
    assert payload["stations"][0]["telecode"] == "XAY"



def test_search_endpoint_rejects_invalid_station():
    client = TestClient(create_app(provider=FakeProvider()))

    response = client.post(
        "/api/search",
        json={"travel_date": "2026-05-01", "departure_station": "火星", "arrival_station": "十堰"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "请选择有效的 12306 站点"
