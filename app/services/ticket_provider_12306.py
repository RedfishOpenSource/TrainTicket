from __future__ import annotations

from datetime import date, datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

import httpx
from urllib.parse import parse_qsl, urljoin, urlparse

from app.models.domain import SeatOption, TrainStop, TrainTrip
from app.services.cache import TTLCache


UNSELLABLE_INVENTORY = {"", "无", "--", "候补"}


class TicketProvider12306:
    station_js_url = "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js"
    left_ticket_init_url = "https://kyfw.12306.cn/otn/leftTicket/init"
    left_ticket_url = "https://kyfw.12306.cn/otn/leftTicket/query"
    FROM_STATION_INDEX = 6
    TO_STATION_INDEX = 7
    DEPARTURE_TIME_INDEX = 8
    ARRIVAL_TIME_INDEX = 9
    TRAVEL_DAY_INDEX = 13
    HARD_SEAT_INDEX = 29
    HARD_SLEEPER_INDEX = 28
    NO_SEAT_INDEX = 26
    TRAIN_NO_INDEX = 2
    TRAIN_NUMBER_INDEX = 3
    START_STATION_CODE_INDEX = 4
    END_STATION_CODE_INDEX = 5
    FROM_STATION_NO_INDEX = 16
    TO_STATION_NO_INDEX = 17
    SEAT_TYPES_INDEX = 35

    def __init__(self, http_client: httpx.Client | None = None) -> None:
        self.http_client = http_client or httpx.Client()
        self.station_codes: dict[str, str] = {}
        self._left_ticket_cache = TTLCache[tuple[dict, str]](ttl_seconds=60)
        self._stop_list_cache = TTLCache[list[dict]](ttl_seconds=300)
        self._price_cache = TTLCache[dict](ttl_seconds=300)

    def parse_station_mapping(self, raw_text: str) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for block in raw_text.split("@"):
            if not block:
                continue
            parts = block.split("|")
            if len(parts) < 3:
                continue
            mapping[parts[1]] = parts[2]
        return mapping

    def load_station_codes(self) -> dict[str, str]:
        response = self.http_client.get(self.station_js_url, timeout=10)
        response.raise_for_status()
        text = getattr(response, "text", "")
        if "=" in text:
            text = text.split("=", 1)[1].strip().strip("';\"")
        self.station_codes = self.parse_station_mapping(text)
        return self.station_codes

    def search_trips(self, travel_date: date, departure_station: str, arrival_station: str) -> list[TrainTrip]:
        if not self.station_codes:
            self.load_station_codes()

        from_code = self.station_codes[departure_station]
        to_code = self.station_codes[arrival_station]
        base_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "zh-CN,zh;q=0.9",
        }
        payload, referer = self._load_left_ticket_payload(
            travel_date=travel_date.isoformat(),
            departure_station=departure_station,
            arrival_station=arrival_station,
            from_code=from_code,
            to_code=to_code,
            base_headers=base_headers,
        )
        return self._normalize_trips(payload, referer=referer, headers=base_headers)

    def _load_left_ticket_payload(self, travel_date: str, departure_station: str, arrival_station: str, from_code: str, to_code: str, base_headers: dict[str, str]) -> tuple[dict, str]:
        cache_key = "|".join((travel_date, departure_station, arrival_station, from_code, to_code))
        cached = self._left_ticket_cache.get(cache_key)
        if cached is not None:
            return cached

        query_params = {
            "leftTicketDTO.train_date": travel_date,
            "leftTicketDTO.from_station": from_code,
            "leftTicketDTO.to_station": to_code,
            "purpose_codes": "ADULT",
        }
        referer = self._request_url(self.left_ticket_init_url, {
            "linktypeid": "dc",
            "fs": f"{departure_station},{from_code}",
            "ts": f"{arrival_station},{to_code}",
            "date": travel_date,
            "flag": "N,N,Y",
        })
        init_response = self.http_client.get(
            self.left_ticket_init_url,
            params={
                "linktypeid": "dc",
                "fs": f"{departure_station},{from_code}",
                "ts": f"{arrival_station},{to_code}",
                "date": travel_date,
                "flag": "N,N,Y",
            },
            headers={
                **base_headers,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            },
            timeout=10,
        )
        init_response.raise_for_status()
        query_response = self.http_client.get(
            self.left_ticket_url,
            params=query_params,
            headers={**base_headers, "Referer": referer, "X-Requested-With": "XMLHttpRequest"},
            timeout=10,
        )
        if query_response.status_code in {301, 302, 303, 307, 308} and query_response.headers.get("location"):
            payload = self._follow_query_redirect(query_response.headers["location"], base_headers, referer)
        else:
            query_response.raise_for_status()
            payload = query_response.json()
        result = (payload, referer)
        self._left_ticket_cache.set(cache_key, result)
        return result

    def _follow_query_redirect(self, location: str, base_headers: dict[str, str], referer: str) -> dict:
        parsed = urlparse(location)
        redirect_url = urljoin(self.left_ticket_url, parsed.path)
        redirect_params = dict(parse_qsl(parsed.query))
        response = self.http_client.get(
            redirect_url,
            params=redirect_params,
            headers={**base_headers, "Referer": referer, "X-Requested-With": "XMLHttpRequest"},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    def _request_url(self, base_url: str, params: dict[str, str]) -> str:
        return str(httpx.URL(base_url, params=params))

    def _query_stop_list(self, train_no: str, from_station_telecode: str, to_station_telecode: str, depart_date: str, referer: str, headers: dict[str, str]) -> list[dict]:
        cache_key = "|".join((train_no, from_station_telecode, to_station_telecode, depart_date))
        cached = self._stop_list_cache.get(cache_key)
        if cached is not None:
            return cached

        response = self.http_client.get(
            "https://kyfw.12306.cn/otn/czxx/queryByTrainNo",
            params={
                "train_no": train_no,
                "from_station_telecode": from_station_telecode,
                "to_station_telecode": to_station_telecode,
                "depart_date": depart_date,
            },
            headers={**headers, "Referer": referer, "X-Requested-With": "XMLHttpRequest"},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json().get("data", {}).get("data", [])
        self._stop_list_cache.set(cache_key, payload)
        return payload

    def _query_ticket_price(self, train_no: str, from_station_no: str, to_station_no: str, seat_types: str, train_date: str, referer: str, headers: dict[str, str]) -> dict:
        cache_key = "|".join((train_no, from_station_no, to_station_no, seat_types, train_date))
        cached = self._price_cache.get(cache_key)
        if cached is not None:
            return cached

        response = self.http_client.get(
            "https://kyfw.12306.cn/otn/leftTicket/queryTicketPrice",
            params={
                "train_no": train_no,
                "from_station_no": from_station_no,
                "to_station_no": to_station_no,
                "seat_types": seat_types,
                "train_date": train_date,
            },
            headers={**headers, "Referer": referer, "X-Requested-With": "XMLHttpRequest"},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json().get("data", {})
        self._price_cache.set(cache_key, payload)
        return payload

    def _normalize_trips(self, payload: dict, referer: str | None = None, headers: dict[str, str] | None = None) -> list[TrainTrip]:
        results = payload.get("data", {}).get("result", [])
        station_map = payload.get("data", {}).get("map", {})
        trips: list[TrainTrip] = []
        headers = headers or {}

        for row in results:
            parts = row.split("|")
            if len(parts) <= self.ARRIVAL_TIME_INDEX:
                continue
            from_code = parts[self.FROM_STATION_INDEX]
            to_code = parts[self.TO_STATION_INDEX]
            departure_time = parts[self.DEPARTURE_TIME_INDEX]
            arrival_time = parts[self.ARRIVAL_TIME_INDEX]
            start_station = station_map.get(from_code, from_code)
            end_station = station_map.get(to_code, to_code)
            travel_day = parts[self.TRAVEL_DAY_INDEX] if len(parts) > self.TRAVEL_DAY_INDEX and parts[self.TRAVEL_DAY_INDEX] else date.today().isoformat()
            depart_at = datetime.fromisoformat(f"{travel_day}T{departure_time}:00")
            arrive_at = datetime.fromisoformat(f"{travel_day}T{arrival_time}:00")
            if arrive_at < depart_at:
                arrive_at += timedelta(days=1)

            train_no = parts[self.TRAIN_NO_INDEX]
            train_number = parts[self.TRAIN_NUMBER_INDEX]
            basic_seat_options = self._seat_options_from_row(parts)
            basic_trip = TrainTrip(
                train_number=train_number,
                train_code=train_no,
                stops=[
                    TrainStop(name=start_station, arrive_at=None, depart_at=depart_at),
                    TrainStop(name=end_station, arrive_at=arrive_at, depart_at=None),
                ],
                seat_inventory={(0, 1): basic_seat_options},
                travel_date=depart_at.date(),
            )
            formatted_travel_day = f"{travel_day[:4]}-{travel_day[4:6]}-{travel_day[6:8]}" if '-' not in travel_day else travel_day
            try:
                if len(parts) <= self.SEAT_TYPES_INDEX:
                    raise ValueError("Row does not include enrichment fields")
                stop_rows = self._query_stop_list(train_no, from_code, to_code, formatted_travel_day, referer or "", headers)
                price_data = self._query_ticket_price(
                    train_no=train_no,
                    from_station_no=parts[self.FROM_STATION_NO_INDEX],
                    to_station_no=parts[self.TO_STATION_NO_INDEX],
                    seat_types=parts[self.SEAT_TYPES_INDEX],
                    train_date=formatted_travel_day,
                    referer=referer or "",
                    headers=headers,
                )
                stops = self._build_stops(stop_rows, travel_day)
                from_index = next(index for index, stop in enumerate(stops) if stop.name == start_station)
                to_index = next(index for index, stop in enumerate(stops) if stop.name == end_station)
                seat_inventory = {(from_index, to_index): self._seat_options_from_price_data(parts, price_data)}
                seat_inventory.update(
                    self._collect_same_train_segments(
                        travel_date=formatted_travel_day,
                        stops=stops,
                        requested_from_index=from_index,
                        requested_to_index=to_index,
                        train_code=train_no,
                        base_headers=headers,
                    )
                )
                trips.append(
                    TrainTrip(
                        train_number=train_number,
                        train_code=train_no,
                        stops=stops,
                        seat_inventory=seat_inventory,
                        travel_date=depart_at.date(),
                    )
                )
            except Exception:
                trips.append(basic_trip)

        return trips

    def _seat_options_from_row(self, parts: list[str]) -> list[SeatOption]:
        seat_options: list[SeatOption] = []
        if len(parts) > self.NO_SEAT_INDEX:
            seat_options.append(SeatOption(seat_type="无座", price=0.0, available=self._is_sellable_inventory(parts[self.NO_SEAT_INDEX])))
        if len(parts) > self.HARD_SEAT_INDEX:
            seat_options.append(SeatOption(seat_type="硬座", price=0.0, available=self._is_sellable_inventory(parts[self.HARD_SEAT_INDEX])))
        if len(parts) > self.HARD_SLEEPER_INDEX:
            seat_options.append(SeatOption(seat_type="硬卧", price=0.0, available=self._is_sellable_inventory(parts[self.HARD_SLEEPER_INDEX])))
        return seat_options or [SeatOption(seat_type="未知座席", price=0.0, available=True)]

    def _seat_options_from_price_data(self, parts: list[str], price_data: dict) -> list[SeatOption]:
        seat_options: list[SeatOption] = []
        if len(parts) > self.NO_SEAT_INDEX:
            seat_options.append(SeatOption(seat_type="无座", price=self._parse_price(price_data.get("WZ")), available=self._is_sellable_inventory(parts[self.NO_SEAT_INDEX])))
        if len(parts) > self.HARD_SEAT_INDEX:
            seat_options.append(SeatOption(seat_type="硬座", price=self._parse_price(price_data.get("A1") or price_data.get("WZ")), available=self._is_sellable_inventory(parts[self.HARD_SEAT_INDEX])))
        if len(parts) > self.HARD_SLEEPER_INDEX:
            seat_options.append(SeatOption(seat_type="硬卧", price=self._parse_price(price_data.get("A4") or price_data.get("A3")), available=self._is_sellable_inventory(parts[self.HARD_SLEEPER_INDEX])))
        return seat_options or [SeatOption(seat_type="未知座席", price=0.0, available=True)]

    def _is_sellable_inventory(self, value: str) -> bool:
        return value not in UNSELLABLE_INVENTORY

    def _parse_price(self, value: str | None) -> float:
        if not value:
            return 0.0
        return float(value.replace("¥", "").replace("￥", ""))

    def _segment_travel_date(self, stop: TrainStop) -> str:
        departure_or_arrival = stop.depart_at or stop.arrive_at
        if departure_or_arrival is None:
            raise ValueError("Stop must include a timestamp")
        return departure_or_arrival.date().isoformat()

    def _collect_same_train_segments(self, travel_date: str, stops: list[TrainStop], requested_from_index: int, requested_to_index: int, train_code: str, base_headers: dict[str, str]) -> dict[tuple[int, int], list[SeatOption]]:
        seat_inventory: dict[tuple[int, int], list[SeatOption]] = {}
        station_names = [stop.name for stop in stops]
        segment_candidates = {
            (requested_from_index, alight_index)
            for alight_index in range(requested_from_index + 1, len(stops))
        }
        segment_candidates.update(
            (board_index, requested_to_index)
            for board_index in range(0, requested_to_index)
        )
        segment_candidates.update(
            (board_index, alight_index)
            for board_index in range(0, requested_from_index)
            for alight_index in range(requested_to_index + 1, len(stops))
        )
        segment_candidates.update(
            (board_index, board_index + 1)
            for board_index in range(requested_from_index, requested_to_index)
        )

        def load_segment(board_index: int, alight_index: int) -> tuple[tuple[int, int], list[SeatOption] | None]:
            departure_station = station_names[board_index]
            arrival_station = station_names[alight_index]
            from_code = self.station_codes.get(departure_station)
            to_code = self.station_codes.get(arrival_station)
            if from_code is None or to_code is None:
                return (board_index, alight_index), None
            try:
                segment_travel_date = self._segment_travel_date(stops[board_index])
                payload, referer = self._load_left_ticket_payload(segment_travel_date, departure_station, arrival_station, from_code, to_code, base_headers)
                matching_row = next(
                    row.split("|")
                    for row in payload.get("data", {}).get("result", [])
                    if row.split("|")[self.TRAIN_NO_INDEX] == train_code
                )
                if len(matching_row) <= self.SEAT_TYPES_INDEX:
                    return (board_index, alight_index), None
                travel_day = matching_row[self.TRAVEL_DAY_INDEX]
                formatted_travel_day = f"{travel_day[:4]}-{travel_day[4:6]}-{travel_day[6:8]}" if '-' not in travel_day else travel_day
                price_data = self._query_ticket_price(
                    train_no=matching_row[self.TRAIN_NO_INDEX],
                    from_station_no=matching_row[self.FROM_STATION_NO_INDEX],
                    to_station_no=matching_row[self.TO_STATION_NO_INDEX],
                    seat_types=matching_row[self.SEAT_TYPES_INDEX],
                    train_date=formatted_travel_day,
                    referer=referer,
                    headers=base_headers,
                )
                seat_options = self._seat_options_from_price_data(matching_row, price_data)
                if any(seat.available for seat in seat_options):
                    return (board_index, alight_index), seat_options
            except Exception:
                return (board_index, alight_index), None
            return (board_index, alight_index), None

        max_workers = min(8, max(1, len(segment_candidates)))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for segment_key, seat_options in executor.map(lambda item: load_segment(*item), sorted(segment_candidates)):
                if seat_options is not None:
                    seat_inventory[segment_key] = seat_options
        return seat_inventory

    def _build_stops(self, stop_rows: list[dict], travel_day: str) -> list[TrainStop]:
        stops: list[TrainStop] = []
        current_day = datetime.fromisoformat(f"{travel_day}T00:00:00")
        previous_clock: tuple[int, int] | None = None
        for row in stop_rows:
            arrive_at = self._combine_stop_time(current_day, row.get("arrive_time"), previous_clock)
            if arrive_at is not None:
                current_day = arrive_at.replace(hour=0, minute=0, second=0, microsecond=0)
                previous_clock = (arrive_at.hour, arrive_at.minute)
            depart_at = self._combine_stop_time(current_day, row.get("start_time"), previous_clock)
            if depart_at is not None:
                current_day = depart_at.replace(hour=0, minute=0, second=0, microsecond=0)
                previous_clock = (depart_at.hour, depart_at.minute)
            stops.append(TrainStop(name=row["station_name"], arrive_at=arrive_at, depart_at=depart_at))
        return stops

    def _combine_stop_time(self, current_day: datetime, value: str | None, previous_clock: tuple[int, int] | None) -> datetime | None:
        if not value or value == "----":
            return None
        hour, minute = map(int, value.split(":"))
        candidate = current_day.replace(hour=hour, minute=minute)
        if previous_clock and (hour, minute) < previous_clock:
            candidate += timedelta(days=1)
        return candidate

    def close(self) -> None:
        close = getattr(self.http_client, "close", None)
        if callable(close):
            close()
