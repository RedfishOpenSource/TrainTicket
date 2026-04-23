from __future__ import annotations

from math import inf

from app.models.domain import PlanStrategy, PurchasePlan, SeatOption, TrainTrip
from app.services.plan_utils import best_available_seat, build_plan_segment
from app.services.ranking import sort_plans



def _travel_minutes(trip: TrainTrip, board_index: int, alight_index: int) -> int:
    depart_at = trip.stops[board_index].depart_at
    arrive_at = trip.stops[alight_index].arrive_at
    if depart_at is None or arrive_at is None:
        raise ValueError("Trip stops must have departure and arrival times")
    return int((arrive_at - depart_at).total_seconds() // 60)



def find_best_same_train_plan(trip: TrainTrip, departure_station: str, arrival_station: str) -> PurchasePlan | None:
    start = trip.station_index(departure_station)
    end = trip.station_index(arrival_station)
    if start >= end:
        raise ValueError("Departure station must come before arrival station")

    direct_seat = best_available_seat(trip.seat_inventory.get((start, end), []))
    if direct_seat is not None:
        direct_segment = build_plan_segment(trip, start, end, direct_seat)
        return PurchasePlan(
            strategy=PlanStrategy.DIRECT,
            total_travel_minutes=_travel_minutes(trip, start, end),
            total_price=direct_seat.price,
            segments=[direct_segment],
            purchase_steps=[f"购买 {departure_station} 到 {arrival_station} 的 {trip.train_number} {direct_seat.seat_type}"],
        )

    candidates: list[PurchasePlan] = []

    for board_index in range(0, start + 1):
        for alight_index in range(end, len(trip.stops)):
            if board_index == start and alight_index == end:
                continue
            seat = best_available_seat(trip.seat_inventory.get((board_index, alight_index), []))
            if seat is None:
                continue
            segment = build_plan_segment(trip, board_index, alight_index, seat)
            candidates.append(
                PurchasePlan(
                    strategy=PlanStrategy.BUY_LONGER,
                    total_travel_minutes=_travel_minutes(trip, start, end),
                    total_price=seat.price,
                    segments=[segment],
                    purchase_steps=[
                        f"购买 {segment.board_station} 到 {segment.alight_station} 的 {trip.train_number} {seat.seat_type}",
                        f"实际乘坐区间为 {departure_station} 到 {arrival_station}",
                    ],
                )
            )

    best_costs = [inf] * (end + 1)
    best_paths: list[list[tuple[int, int, SeatOption]] | None] = [None] * (end + 1)
    best_costs[start] = 0.0
    best_paths[start] = []

    for board_index in range(start, end):
        if best_paths[board_index] is None:
            continue
        for alight_index in range(board_index + 1, end + 1):
            seat = best_available_seat(trip.seat_inventory.get((board_index, alight_index), []))
            if seat is None:
                continue
            next_cost = best_costs[board_index] + seat.price
            if next_cost < best_costs[alight_index]:
                best_costs[alight_index] = next_cost
                best_paths[alight_index] = [*best_paths[board_index], (board_index, alight_index, seat)]

    if best_paths[end]:
        segments = [build_plan_segment(trip, board_index, alight_index, seat) for board_index, alight_index, seat in best_paths[end]]
        candidates.append(
            PurchasePlan(
                strategy=PlanStrategy.SPLIT_TICKET,
                total_travel_minutes=_travel_minutes(trip, start, end),
                total_price=round(sum(segment.price for segment in segments), 2),
                segments=segments,
                purchase_steps=[
                    f"分段购买 {segment.board_station} 到 {segment.alight_station} 的 {segment.train_number} {segment.seat_type}"
                    for segment in segments
                ],
            )
        )

    if not candidates:
        return None
    return sort_plans(candidates)[0]
