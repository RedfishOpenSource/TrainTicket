from fastapi.testclient import TestClient

from app.main import create_app
from app.models.domain import SeatOption, TrainStop, TrainTrip


class FakeProvider:
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



def test_search_endpoint_returns_empty_when_only_later_boarding_segments_have_inventory():
    class LaterBoardingOnlyProvider:
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
    assert response.json() == {"plans": []}
