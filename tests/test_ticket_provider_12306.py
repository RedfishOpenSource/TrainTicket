from datetime import date

from app.services.ticket_provider_12306 import TicketProvider12306


class FakeHttpClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        payload = self.responses.pop(0)
        return FakeResponse(**payload)


class FakeResponse:
    def __init__(self, json_payload=None, text="", headers=None, status_code=200):
        self._json_payload = json_payload
        self.text = text
        self.headers = headers or {}
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._json_payload


class RoutingHttpClient:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        params = params or {}
        self.calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        route_key = (url, tuple(sorted(params.items())))
        payload = self.routes.get(route_key, self.routes.get((url, None)))
        if payload is None:
            raise AssertionError(f"Unexpected request: {url} {params}")
        return FakeResponse(**payload)



def build_left_ticket_row(*, train_no, train_number, start_code, end_code, from_code, to_code, departure_time, arrival_time, travel_day, from_station_no, to_station_no, no_seat="", hard_sleeper="", hard_seat="", secret="secret", bookable="预订", seat_types="1431"):
    parts = [""] * 58
    parts[0] = secret
    parts[1] = bookable
    parts[2] = train_no
    parts[3] = train_number
    parts[4] = start_code
    parts[5] = end_code
    parts[6] = from_code
    parts[7] = to_code
    parts[8] = departure_time
    parts[9] = arrival_time
    parts[10] = "03:00"
    parts[11] = "Y"
    parts[12] = "mock"
    parts[13] = travel_day
    parts[14] = "3"
    parts[15] = "V2"
    parts[16] = from_station_no
    parts[17] = to_station_no
    parts[18] = "1"
    parts[19] = "0"
    parts[23] = "无"
    parts[26] = no_seat
    parts[28] = hard_sleeper
    parts[29] = hard_seat
    parts[34] = "104030W0"
    parts[35] = seat_types
    parts[36] = "0"
    parts[37] = "1"
    parts[39] = "mock"
    return "|".join(parts)



def test_parses_station_mapping_from_official_station_js():
    provider = TicketProvider12306(http_client=FakeHttpClient([]))

    mapping = provider.parse_station_mapping("@bjb|北京北|VAP|beijingbei|bjb|0@xiy|西安|XAY|xian|xa|1@syf|十堰|SNN|shiyan|sy|2")

    assert mapping["西安"] == "XAY"
    assert mapping["十堰"] == "SNN"



def test_normalizes_left_ticket_rows_to_trip_models():
    payload = {
        "data": {
            "result": [
                "secret|预订|240000K10000|K1|BXP|CSQ|XAY|SNN|08:05|12:00|03:55|Y|mock|2026-05-01|3|P3|01|07|0|0||||||||||1|有",
            ],
            "map": {"XAY": "西安", "SNN": "十堰", "BXP": "大同", "CSQ": "长沙"},
        }
    }
    client = FakeHttpClient([
        {"text": "<html>init</html>"},
        {"json_payload": payload},
    ])
    provider = TicketProvider12306(http_client=client)
    provider.station_codes = {"西安": "XAY", "十堰": "SNN"}

    trips = provider.search_trips(date(2026, 5, 1), "西安", "十堰")

    assert len(trips) == 1
    assert trips[0].train_number == "K1"
    assert trips[0].stops[0].name == "西安"
    assert trips[0].stops[1].name == "十堰"
    assert any(seat.available for seat in trips[0].seat_inventory[(0, 1)])



def test_follows_init_then_queryg_flow_for_live_12306_queries():
    payload = {
        "data": {
            "result": [
                "secret|预订|240000K10000|K1|BXP|CSQ|XAY|SNN|08:05|12:00|03:55|Y|mock|2026-05-01|3|P3|01|07|0|0||||||||||1|有",
            ],
            "map": {"XAY": "西安", "SNN": "十堰", "BXP": "大同", "CSQ": "长沙"},
        }
    }
    client = FakeHttpClient([
        {"text": "<html>init</html>"},
        {"headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=XAY&leftTicketDTO.to_station=SNN&purpose_codes=ADULT"}, "status_code": 302},
        {"json_payload": payload},
    ])
    provider = TicketProvider12306(http_client=client)
    provider.station_codes = {"西安": "XAY", "十堰": "SNN"}

    trips = provider.search_trips(date(2026, 5, 1), "西安", "十堰")

    assert len(trips) == 1
    assert [call["url"] for call in client.calls] == [
        "https://kyfw.12306.cn/otn/leftTicket/init",
        "https://kyfw.12306.cn/otn/leftTicket/query",
        "https://kyfw.12306.cn/otn/leftTicket/queryG",
    ]
    assert client.calls[1]["headers"]["X-Requested-With"] == "XMLHttpRequest"



def test_keeps_basic_trip_when_enrichment_is_unavailable():
    payload = {
        "data": {
            "result": [
                "secret|预订|240000K10000|K1|BXP|CSQ|XAY|SNN|08:05|12:00|03:55|Y|mock|2026-05-01|3|P3|01|07|0|0||||||||||1|有",
            ],
            "map": {"XAY": "西安", "SNN": "十堰", "BXP": "大同", "CSQ": "长沙"},
        }
    }
    client = FakeHttpClient([
        {"text": "<html>init</html>"},
        {"headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=XAY&leftTicketDTO.to_station=SNN&purpose_codes=ADULT"}, "status_code": 302},
        {"json_payload": payload},
    ])
    provider = TicketProvider12306(http_client=client)
    provider.station_codes = {"西安": "XAY", "十堰": "SNN"}

    trips = provider.search_trips(date(2026, 5, 1), "西安", "十堰")

    assert len(trips) == 1
    assert [stop.name for stop in trips[0].stops] == ["西安", "十堰"]
    assert (0, 1) in trips[0].seat_inventory



def test_exposes_wz_inventory_as_available_seat_option():
    left_ticket_payload = {
        "data": {
            "result": [
                build_left_ticket_row(
                    train_no="28000K209501",
                    train_number="K2098",
                    start_code="DTV",
                    end_code="CSQ",
                    from_code="AKY",
                    to_code="SNN",
                    departure_time="09:21",
                    arrival_time="12:21",
                    travel_day="2026-05-01",
                    from_station_no="21",
                    to_station_no="24",
                    no_seat="5",
                    hard_sleeper="无",
                    hard_seat="无",
                ),
            ],
            "map": {"AKY": "安康", "SNN": "十堰", "DTV": "大同", "CSQ": "长沙"},
        }
    }
    stop_list_payload = {
        "data": {
            "data": [
                {"station_name": "大同", "arrive_time": "----", "start_time": "14:42", "station_no": "01"},
                {"station_name": "安康", "arrive_time": "09:01", "start_time": "09:21", "station_no": "21"},
                {"station_name": "十堰", "arrive_time": "12:21", "start_time": "12:24", "station_no": "24"},
                {"station_name": "长沙", "arrive_time": "22:38", "start_time": "22:38", "station_no": "33"},
            ]
        }
    }
    price_payload = {"data": {"WZ": "¥53.5", "A4": "¥152.5"}}
    client = FakeHttpClient([
        {"text": "<html>init</html>"},
        {"headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=AKY&leftTicketDTO.to_station=SNN&purpose_codes=ADULT"}, "status_code": 302},
        {"json_payload": left_ticket_payload},
        {"json_payload": stop_list_payload},
        {"json_payload": price_payload},
    ])
    provider = TicketProvider12306(http_client=client)
    provider.station_codes = {"安康": "AKY", "十堰": "SNN"}

    trips = provider.search_trips(date(2026, 5, 1), "安康", "十堰")

    seat_options = trips[0].seat_inventory[(1, 2)]
    wz = next(seat for seat in seat_options if seat.seat_type == "无座")
    assert wz.available is True
    assert wz.price == 53.5


def test_enriches_trip_with_stop_list_and_segment_prices():
    left_ticket_payload = {
        "data": {
            "result": [
                "secret|预订|28000K209501|K2098|DTV|CSQ|XAY|SNN|05:52|12:21|06:29|Y|mock|2026-04-30|3|V2|20|24|1|0||||无|||无|无|||||104030W0|1431|0|1||mock|",
            ],
            "map": {"XAY": "西安", "SNN": "十堰", "DTV": "大同", "CSQ": "长沙"},
        }
    }
    stop_list_payload = {
        "data": {
            "data": [
                {"station_name": "大同", "arrive_time": "----", "start_time": "14:42", "station_no": "01"},
                {"station_name": "西安", "arrive_time": "05:31", "start_time": "05:52", "station_no": "20"},
                {"station_name": "安康", "arrive_time": "09:01", "start_time": "09:21", "station_no": "21"},
                {"station_name": "十堰", "arrive_time": "12:21", "start_time": "12:24", "station_no": "24"},
                {"station_name": "长沙", "arrive_time": "22:38", "start_time": "22:38", "station_no": "33"},
            ]
        }
    }
    price_payload = {"data": {"A4": "¥152.5", "A3": "¥99.5", "A1": "¥53.5", "WZ": "¥53.5"}}
    client = FakeHttpClient([
        {"text": "<html>init</html>"},
        {"headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=XAY&leftTicketDTO.to_station=SNN&purpose_codes=ADULT"}, "status_code": 302},
        {"json_payload": left_ticket_payload},
        {"json_payload": stop_list_payload},
        {"json_payload": price_payload},
    ])
    provider = TicketProvider12306(http_client=client)
    provider.station_codes = {"西安": "XAY", "十堰": "SNN"}

    trips = provider.search_trips(date(2026, 5, 1), "西安", "十堰")

    assert len(trips) == 1
    trip = trips[0]
    assert [stop.name for stop in trip.stops] == ["大同", "西安", "安康", "十堰", "长沙"]
    assert (1, 3) in trip.seat_inventory
    prices = {seat.seat_type: seat.price for seat in trip.seat_inventory[(1, 3)]}
    assert prices["硬卧"] == 152.5
    assert prices["硬座"] == 53.5
    assert client.calls[3]["params"]["depart_date"] == "2026-04-30"
    assert client.calls[4]["params"]["train_date"] == "2026-04-30"



def test_adds_covering_segments_from_same_train_queries():
    direct_payload = {
        "data": {
            "result": [
                build_left_ticket_row(
                    train_no="28000K209501",
                    train_number="K2098",
                    start_code="DTV",
                    end_code="CSQ",
                    from_code="XAY",
                    to_code="SNN",
                    departure_time="05:52",
                    arrival_time="12:21",
                    travel_day="2026-04-30",
                    from_station_no="20",
                    to_station_no="24",
                    no_seat="无",
                    hard_sleeper="无",
                    hard_seat="无",
                ),
            ],
            "map": {"XAY": "西安", "SNN": "十堰", "DTV": "大同", "CSQ": "长沙"},
        }
    }
    covering_payload = {
        "data": {
            "result": [
                build_left_ticket_row(
                    train_no="28000K209501",
                    train_number="K2098",
                    start_code="DTV",
                    end_code="CSQ",
                    from_code="XAY",
                    to_code="XUY",
                    departure_time="05:52",
                    arrival_time="10:27",
                    travel_day="2026-04-30",
                    from_station_no="20",
                    to_station_no="22",
                    no_seat="10",
                    hard_sleeper="3",
                    hard_seat="无",
                ),
            ],
            "map": {"XAY": "西安", "XUY": "旬阳", "DTV": "大同", "CSQ": "长沙"},
        }
    }
    stop_list_payload = {
        "data": {
            "data": [
                {"station_name": "大同", "arrive_time": "----", "start_time": "14:42", "station_no": "01"},
                {"station_name": "西安", "arrive_time": "05:31", "start_time": "05:52", "station_no": "20"},
                {"station_name": "安康", "arrive_time": "09:01", "start_time": "09:21", "station_no": "21"},
                {"station_name": "旬阳", "arrive_time": "10:27", "start_time": "10:29", "station_no": "22"},
                {"station_name": "十堰", "arrive_time": "12:21", "start_time": "12:24", "station_no": "24"},
                {"station_name": "长沙", "arrive_time": "22:38", "start_time": "22:38", "station_no": "33"},
            ]
        }
    }
    direct_price_payload = {"data": {"A4": "¥152.5", "A1": "¥53.5", "WZ": "¥53.5"}}
    covering_price_payload = {"data": {"A4": "¥126.5", "A1": "¥44.5", "WZ": "¥44.5"}}
    init_url = "https://kyfw.12306.cn/otn/leftTicket/init"
    query_url = "https://kyfw.12306.cn/otn/leftTicket/query"
    query_g_url = "https://kyfw.12306.cn/otn/leftTicket/queryG"
    stop_url = "https://kyfw.12306.cn/otn/czxx/queryByTrainNo"
    price_url = "https://kyfw.12306.cn/otn/leftTicket/queryTicketPrice"
    client = RoutingHttpClient({
        (init_url, None): {"text": "<html>init</html>"},
        (query_url, (("leftTicketDTO.from_station", "XAY"), ("leftTicketDTO.to_station", "SNN"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {
            "headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=XAY&leftTicketDTO.to_station=SNN&purpose_codes=ADULT"},
            "status_code": 302,
        },
        (query_g_url, (("leftTicketDTO.from_station", "XAY"), ("leftTicketDTO.to_station", "SNN"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {"json_payload": direct_payload},
        (query_url, (("leftTicketDTO.from_station", "XAY"), ("leftTicketDTO.to_station", "XUY"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {
            "headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=XAY&leftTicketDTO.to_station=XUY&purpose_codes=ADULT"},
            "status_code": 302,
        },
        (query_g_url, (("leftTicketDTO.from_station", "XAY"), ("leftTicketDTO.to_station", "XUY"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {"json_payload": covering_payload},
        (stop_url, (("depart_date", "2026-04-30"), ("from_station_telecode", "XAY"), ("to_station_telecode", "SNN"), ("train_no", "28000K209501"))): {"json_payload": stop_list_payload},
        (stop_url, (("depart_date", "2026-04-30"), ("from_station_telecode", "XAY"), ("to_station_telecode", "XUY"), ("train_no", "28000K209501"))): {"json_payload": stop_list_payload},
        (price_url, (("from_station_no", "20"), ("seat_types", "1431"), ("to_station_no", "24"), ("train_date", "2026-04-30"), ("train_no", "28000K209501"))): {"json_payload": direct_price_payload},
        (price_url, (("from_station_no", "20"), ("seat_types", "1431"), ("to_station_no", "22"), ("train_date", "2026-04-30"), ("train_no", "28000K209501"))): {"json_payload": covering_price_payload},
    })
    provider = TicketProvider12306(http_client=client)
    provider.station_codes = {"西安": "XAY", "十堰": "SNN", "旬阳": "XUY"}

    trips = provider.search_trips(date(2026, 5, 1), "西安", "十堰")

    trip = trips[0]
    assert (1, 4) in trip.seat_inventory
    assert (1, 3) in trip.seat_inventory
    assert any(seat.available for seat in trip.seat_inventory[(1, 3)])



def test_uses_boarding_date_for_same_train_segment_queries():
    direct_payload = {
        "data": {
            "result": [
                build_left_ticket_row(
                    train_no="28000K209501",
                    train_number="K2098",
                    start_code="DTV",
                    end_code="CSQ",
                    from_code="XAY",
                    to_code="SNN",
                    departure_time="05:52",
                    arrival_time="12:21",
                    travel_day="2026-04-30",
                    from_station_no="20",
                    to_station_no="24",
                    no_seat="无",
                    hard_sleeper="无",
                    hard_seat="无",
                ),
            ],
            "map": {"XAY": "西安", "SNN": "十堰", "DTV": "大同", "CSQ": "长沙"},
        }
    }
    segment_payload = {
        "data": {
            "result": [
                build_left_ticket_row(
                    train_no="28000K209501",
                    train_number="K2098",
                    start_code="DTV",
                    end_code="CSQ",
                    from_code="AKY",
                    to_code="SNN",
                    departure_time="09:21",
                    arrival_time="12:21",
                    travel_day="2026-05-01",
                    from_station_no="21",
                    to_station_no="24",
                    no_seat="5",
                    hard_sleeper="无",
                    hard_seat="无",
                ),
            ],
            "map": {"AKY": "安康", "SNN": "十堰", "DTV": "大同", "CSQ": "长沙"},
        }
    }
    stop_list_payload = {
        "data": {
            "data": [
                {"station_name": "大同", "arrive_time": "----", "start_time": "14:42", "station_no": "01"},
                {"station_name": "西安", "arrive_time": "05:31", "start_time": "05:52", "station_no": "20"},
                {"station_name": "安康", "arrive_time": "09:01", "start_time": "09:21", "station_no": "21"},
                {"station_name": "十堰", "arrive_time": "12:21", "start_time": "12:24", "station_no": "24"},
                {"station_name": "长沙", "arrive_time": "22:38", "start_time": "22:38", "station_no": "33"},
            ]
        }
    }
    direct_price_payload = {"data": {"WZ": "¥53.5"}}
    segment_price_payload = {"data": {"WZ": "¥32.5"}}
    init_url = "https://kyfw.12306.cn/otn/leftTicket/init"
    query_url = "https://kyfw.12306.cn/otn/leftTicket/query"
    query_g_url = "https://kyfw.12306.cn/otn/leftTicket/queryG"
    stop_url = "https://kyfw.12306.cn/otn/czxx/queryByTrainNo"
    price_url = "https://kyfw.12306.cn/otn/leftTicket/queryTicketPrice"
    client = RoutingHttpClient({
        (init_url, None): {"text": "<html>init</html>"},
        (query_url, (("leftTicketDTO.from_station", "XAY"), ("leftTicketDTO.to_station", "SNN"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {
            "headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=XAY&leftTicketDTO.to_station=SNN&purpose_codes=ADULT"},
            "status_code": 302,
        },
        (query_g_url, (("leftTicketDTO.from_station", "XAY"), ("leftTicketDTO.to_station", "SNN"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {"json_payload": direct_payload},
        (query_url, (("leftTicketDTO.from_station", "AKY"), ("leftTicketDTO.to_station", "SNN"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {
            "headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=AKY&leftTicketDTO.to_station=SNN&purpose_codes=ADULT"},
            "status_code": 302,
        },
        (query_g_url, (("leftTicketDTO.from_station", "AKY"), ("leftTicketDTO.to_station", "SNN"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {"json_payload": segment_payload},
        (stop_url, (("depart_date", "2026-04-30"), ("from_station_telecode", "XAY"), ("to_station_telecode", "SNN"), ("train_no", "28000K209501"))): {"json_payload": stop_list_payload},
        (price_url, (("from_station_no", "20"), ("seat_types", "1431"), ("to_station_no", "24"), ("train_date", "2026-04-30"), ("train_no", "28000K209501"))): {"json_payload": direct_price_payload},
        (price_url, (("from_station_no", "21"), ("seat_types", "1431"), ("to_station_no", "24"), ("train_date", "2026-05-01"), ("train_no", "28000K209501"))): {"json_payload": segment_price_payload},
    })
    provider = TicketProvider12306(http_client=client)
    provider.station_codes = {"西安": "XAY", "安康": "AKY", "十堰": "SNN"}

    trips = provider.search_trips(date(2026, 5, 1), "西安", "十堰")

    trip = trips[0]
    assert (2, 3) in trip.seat_inventory
    assert any(seat.available for seat in trip.seat_inventory[(2, 3)])



def test_adds_covering_segments_that_start_before_and_end_after_requested_interval():
    direct_payload = {
        "data": {
            "result": [
                build_left_ticket_row(
                    train_no="28000K209501",
                    train_number="K2098",
                    start_code="DTV",
                    end_code="CSQ",
                    from_code="XAY",
                    to_code="SNN",
                    departure_time="05:52",
                    arrival_time="12:21",
                    travel_day="2026-04-30",
                    from_station_no="20",
                    to_station_no="24",
                    no_seat="无",
                    hard_sleeper="无",
                    hard_seat="无",
                ),
            ],
            "map": {"XAY": "西安", "SNN": "十堰", "DTV": "大同", "CSQ": "长沙"},
        }
    }
    covering_payload = {
        "data": {
            "result": [
                build_left_ticket_row(
                    train_no="28000K209501",
                    train_number="K2098",
                    start_code="DTV",
                    end_code="CSQ",
                    from_code="DTV",
                    to_code="CSQ",
                    departure_time="14:42",
                    arrival_time="22:38",
                    travel_day="2026-04-30",
                    from_station_no="01",
                    to_station_no="33",
                    no_seat="有",
                    hard_sleeper="无",
                    hard_seat="3",
                ),
            ],
            "map": {"XAY": "西安", "SNN": "十堰", "DTV": "大同", "CSQ": "长沙"},
        }
    }
    stop_list_payload = {
        "data": {
            "data": [
                {"station_name": "大同", "arrive_time": "----", "start_time": "14:42", "station_no": "01"},
                {"station_name": "西安", "arrive_time": "05:31", "start_time": "05:52", "station_no": "20"},
                {"station_name": "安康", "arrive_time": "09:01", "start_time": "09:21", "station_no": "21"},
                {"station_name": "十堰", "arrive_time": "12:21", "start_time": "12:24", "station_no": "24"},
                {"station_name": "长沙", "arrive_time": "22:38", "start_time": "22:38", "station_no": "33"},
            ]
        }
    }
    direct_price_payload = {"data": {"WZ": "¥53.5"}}
    covering_price_payload = {"data": {"A1": "¥243.5", "WZ": "¥243.5"}}
    init_url = "https://kyfw.12306.cn/otn/leftTicket/init"
    query_url = "https://kyfw.12306.cn/otn/leftTicket/query"
    query_g_url = "https://kyfw.12306.cn/otn/leftTicket/queryG"
    stop_url = "https://kyfw.12306.cn/otn/czxx/queryByTrainNo"
    price_url = "https://kyfw.12306.cn/otn/leftTicket/queryTicketPrice"
    client = RoutingHttpClient({
        (init_url, None): {"text": "<html>init</html>"},
        (query_url, (("leftTicketDTO.from_station", "XAY"), ("leftTicketDTO.to_station", "SNN"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {
            "headers": {"location": "queryG?leftTicketDTO.train_date=2026-05-01&leftTicketDTO.from_station=XAY&leftTicketDTO.to_station=SNN&purpose_codes=ADULT"},
            "status_code": 302,
        },
        (query_g_url, (("leftTicketDTO.from_station", "XAY"), ("leftTicketDTO.to_station", "SNN"), ("leftTicketDTO.train_date", "2026-05-01"), ("purpose_codes", "ADULT"))): {"json_payload": direct_payload},
        (query_url, (("leftTicketDTO.from_station", "DTV"), ("leftTicketDTO.to_station", "CSQ"), ("leftTicketDTO.train_date", "2026-04-30"), ("purpose_codes", "ADULT"))): {
            "headers": {"location": "queryG?leftTicketDTO.train_date=2026-04-30&leftTicketDTO.from_station=DTV&leftTicketDTO.to_station=CSQ&purpose_codes=ADULT"},
            "status_code": 302,
        },
        (query_g_url, (("leftTicketDTO.from_station", "DTV"), ("leftTicketDTO.to_station", "CSQ"), ("leftTicketDTO.train_date", "2026-04-30"), ("purpose_codes", "ADULT"))): {"json_payload": covering_payload},
        (stop_url, (("depart_date", "2026-04-30"), ("from_station_telecode", "XAY"), ("to_station_telecode", "SNN"), ("train_no", "28000K209501"))): {"json_payload": stop_list_payload},
        (price_url, (("from_station_no", "20"), ("seat_types", "1431"), ("to_station_no", "24"), ("train_date", "2026-04-30"), ("train_no", "28000K209501"))): {"json_payload": direct_price_payload},
        (price_url, (("from_station_no", "01"), ("seat_types", "1431"), ("to_station_no", "33"), ("train_date", "2026-04-30"), ("train_no", "28000K209501"))): {"json_payload": covering_price_payload},
    })
    provider = TicketProvider12306(http_client=client)
    provider.station_codes = {"大同": "DTV", "西安": "XAY", "十堰": "SNN", "长沙": "CSQ"}

    trips = provider.search_trips(date(2026, 5, 1), "西安", "十堰")

    trip = trips[0]
    assert (0, 4) in trip.seat_inventory
    assert any(seat.available for seat in trip.seat_inventory[(0, 4)])
