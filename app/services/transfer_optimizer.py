from __future__ import annotations

from collections import deque

from app.models.domain import PlanStrategy, PurchasePlan, SeatOption, TrainTrip
from app.services.plan_utils import best_available_seat, build_plan_segment
from app.services.ranking import plan_sort_key, sort_plans
from app.services.same_train_optimizer import find_best_same_train_plan



def _trip_segments(trip: TrainTrip) -> list[tuple[int, int, SeatOption]]:
    segments: list[tuple[int, int, SeatOption]] = []
    for (board_index, alight_index), seats in trip.seat_inventory.items():
        if board_index >= alight_index:
            continue
        seat = best_available_seat(seats)
        if seat is None:
            continue
        segments.append((board_index, alight_index, seat))
    return segments



def _build_transfer_candidates(trips: list[TrainTrip], departure_station: str, arrival_station: str, min_transfer_minutes: int) -> list[PurchasePlan]:
    adjacency: dict[str, list[PlanSegment]] = {}
    for trip in trips:
        for board_index, alight_index, seat in _trip_segments(trip):
            segment = build_plan_segment(trip, board_index, alight_index, seat)
            adjacency.setdefault(segment.board_station, []).append(segment)

    best_plan_by_station: dict[str, PurchasePlan] = {
        departure_station: PurchasePlan(strategy=PlanStrategy.TRANSFER, total_travel_minutes=0, total_price=0.0, segments=[])
    }
    queue = deque([departure_station])

    while queue:
        station = queue.popleft()
        current_plan = best_plan_by_station[station]
        previous_arrival = current_plan.segments[-1].arrive_at if current_plan.segments else None

        for segment in adjacency.get(station, []):
            if previous_arrival is not None:
                transfer_gap = int((segment.depart_at - previous_arrival).total_seconds() // 60)
                if transfer_gap < min_transfer_minutes:
                    continue
            total_minutes = int((segment.arrive_at - current_plan.segments[0].depart_at).total_seconds() // 60) if current_plan.segments else int((segment.arrive_at - segment.depart_at).total_seconds() // 60)
            next_plan = PurchasePlan(
                strategy=PlanStrategy.TRANSFER,
                total_travel_minutes=total_minutes,
                total_price=round(current_plan.total_price + segment.price, 2),
                segments=[*current_plan.segments, segment],
            )
            best_known = best_plan_by_station.get(segment.alight_station)
            if best_known is None or plan_sort_key(next_plan) < plan_sort_key(best_known):
                best_plan_by_station[segment.alight_station] = next_plan
                queue.append(segment.alight_station)

    plan = best_plan_by_station.get(arrival_station)
    if plan is None or not plan.segments:
        return []
    plan.purchase_steps = [
        f"购买 {segment.board_station} 到 {segment.alight_station} 的 {segment.train_number} {segment.seat_type}"
        for segment in plan.segments
    ]
    return [plan]



def find_best_transfer_plan(
    trips: list[TrainTrip],
    departure_station: str,
    arrival_station: str,
    min_transfer_minutes: int = 20,
) -> PurchasePlan | None:
    same_train_candidates: list[PurchasePlan] = []

    for trip in trips:
        station_names = {stop.name for stop in trip.stops}
        if departure_station in station_names and arrival_station in station_names:
            same_train_plan = find_best_same_train_plan(trip, departure_station, arrival_station)
            if same_train_plan is not None:
                same_train_candidates.append(same_train_plan)

    direct_candidates = [plan for plan in same_train_candidates if plan.strategy == PlanStrategy.DIRECT]
    if direct_candidates:
        return sort_plans(direct_candidates)[0]

    candidates = [*same_train_candidates, *_build_transfer_candidates(trips, departure_station, arrival_station, min_transfer_minutes)]
    if not candidates:
        return None
    return sort_plans(candidates)[0]
