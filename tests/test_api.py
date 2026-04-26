import httpx
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.domain import SeatOption, TrainStop, TrainTrip


class FakeProvider:
    def __init__(self):
        self.stations = [
            {"name": "西安", "telecode": "XAY", "pinyin": "xian", "abbr": "xa"},
            {"name": "十堰", "telecode": "SNN", "pinyin": "shiyan", "abbr": "sy"},
            {"name": "大同", "telecode": "DTV", "pinyin": "datong", "abbr": "dt"},
            {"name": "北京", "telecode": "BJP", "pinyin": "beijing", "abbr": "bj"},
            {"name": "北京南", "telecode": "VNP", "pinyin": "beijingnan", "abbr": "bjn"},
        ]

    def list_stations(self, query="", limit=20):
        return [station for station in self.stations if query.lower() in station["name"].lower() or query.lower() in station["pinyin"]][:limit]

    def list_cities(self, query="", limit=20):
        cities = [
            {
                "city_name": "北京",
                "matched_by": "name",
                "display_label": "2 个车站",
                "stations": [station for station in self.stations if station["name"] in {"北京", "北京南"}],
            },
            {
                "city_name": "西安",
                "matched_by": "name",
                "display_label": "1 个车站",
                "stations": [station for station in self.stations if station["name"] == "西安"],
            },
        ]
        lowered = query.lower()
        return [city for city in cities if not query or lowered in city["city_name"].lower() or any(lowered in station["pinyin"] for station in city["stations"] )][:limit]

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
    assert payload["recommendation_candidates"]["sleeper_priority"][0]["strategy"] == "buy_longer"
    assert payload["failed_candidates"] == []



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
    assert response.json() == {
        "plans": [],
        "recommendations": {},
        "recommendation_candidates": {},
        "failed_candidates": [],
    }



def test_station_endpoint_returns_search_matches():
    client = TestClient(create_app(provider=FakeProvider()))

    response = client.get("/api/stations", params={"q": "xi", "limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["stations"][0]["name"] == "西安"
    assert payload["stations"][0]["telecode"] == "XAY"



def test_cities_endpoint_returns_grouped_city_candidates():
    client = TestClient(create_app(provider=FakeProvider()))

    response = client.get("/api/cities", params={"q": "北京", "limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["cities"][0]["city_name"] == "北京"
    assert any(station["name"] == "北京南" for station in payload["cities"][0]["stations"])



def test_search_endpoint_rejects_invalid_station():
    client = TestClient(create_app(provider=FakeProvider()))

    response = client.post(
        "/api/search",
        json={"travel_date": "2026-05-01", "departure_station": "火星", "arrival_station": "十堰"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "请选择有效的 12306 站点"



def test_search_endpoint_rejects_city_name_without_station_confirmation():
    client = TestClient(create_app(provider=FakeProvider()))

    response = client.post(
        "/api/search",
        json={"travel_date": "2026-05-01", "departure_station": "北京城", "arrival_station": "十堰"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "请选择有效的 12306 站点"



def test_search_endpoint_returns_json_when_12306_upstream_fails():
    class UpstreamFailureProvider(FakeProvider):
        def search_trips(self, travel_date, departure_station, arrival_station):
            request = httpx.Request("GET", "https://kyfw.12306.cn/otn/leftTicket/queryG")
            response = httpx.Response(
                302,
                headers={"location": "https://www.12306.cn/mormhweb/logFiles/error.html"},
                request=request,
            )
            raise httpx.HTTPStatusError("12306 redirect to error page", request=request, response=response)

    client = TestClient(create_app(provider=UpstreamFailureProvider()), raise_server_exceptions=False)

    response = client.post(
        "/api/search",
        json={"travel_date": "2026-05-06", "departure_station": "十堰", "arrival_station": "西安"},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "12306 暂时无法返回有效余票数据，请稍后重试"



def test_search_endpoint_includes_failed_candidates_and_retry_endpoint():
    class FailedCandidateProvider(FakeProvider):
        def __init__(self):
            super().__init__()
            self._failed = [
                {
                    "travel_date": "2026-05-05",
                    "departure_station": "石门县北",
                    "arrival_station": "介休",
                    "train_code": "62000K209602",
                    "reason": "12306 temporary failure",
                }
            ]
            self.retry_dates = []

        def get_last_failed_segments(self):
            return list(self._failed)

        def search_trips(self, travel_date, departure_station, arrival_station):
            self.retry_dates.append(str(travel_date))
            return super().search_trips(travel_date, departure_station, arrival_station)

    provider = FailedCandidateProvider()
    client = TestClient(create_app(provider=provider))

    response = client.post(
        "/api/search",
        json={"travel_date": "2026-05-01", "departure_station": "西安", "arrival_station": "十堰"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["failed_candidates"][0]["departure_station"] == "石门县北"
    assert payload["failed_candidates"][0]["arrival_station"] == "介休"
    assert payload["failed_candidates"][0]["train_code"] == "62000K209602"

    retry_response = client.post(
        "/api/retry-candidate",
        json={
            "travel_date": "2026-05-05",
            "departure_station": "西安",
            "arrival_station": "十堰",
            "train_code": "K1",
        },
    )

    assert retry_response.status_code == 200
    retry_payload = retry_response.json()
    assert retry_payload["candidate"]["travel_date"] == "2026-05-05"
    assert retry_payload["plans"][0]["strategy"] == "buy_longer"
    assert "2026-05-05" in provider.retry_dates


def test_retry_failed_candidates_endpoint_returns_refreshed_search_results():
    class RetryBatchProvider(FakeProvider):
        def __init__(self):
            super().__init__()
            self.fail_once = True

        def get_last_failed_segments(self):
            if self.fail_once:
                return [
                    {
                        "travel_date": "2026-05-05",
                        "departure_station": "石门县北",
                        "arrival_station": "介休",
                        "train_code": "62000K209602",
                        "reason": "12306 temporary failure",
                    }
                ]
            return []

        def search_trips(self, travel_date, departure_station, arrival_station):
            self.fail_once = False
            return super().search_trips(travel_date, departure_station, arrival_station)

    client = TestClient(create_app(provider=RetryBatchProvider()))

    retry_response = client.post(
        "/api/retry-failed-candidates",
        json={
            "travel_date": "2026-05-01",
            "departure_station": "西安",
            "arrival_station": "十堰",
            "candidates": [
                {
                    "travel_date": "2026-05-05",
                    "departure_station": "石门县北",
                    "arrival_station": "介休",
                    "train_code": "62000K209602",
                }
            ]
        },
    )

    assert retry_response.status_code == 200
    retry_payload = retry_response.json()
    assert retry_payload["plans"][0]["strategy"] == "buy_longer"
    assert retry_payload["failed_candidates"] == []
