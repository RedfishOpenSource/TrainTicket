from __future__ import annotations

from app.models.domain import PlanSegment, SeatOption, TrainTrip



def available_seats(seats: list[SeatOption]) -> list[SeatOption]:
    return sorted((seat for seat in seats if seat.available), key=lambda seat: (seat.price, seat.seat_type))



def best_available_seat(seats: list[SeatOption]) -> SeatOption | None:
    available = available_seats(seats)
    if not available:
        return None
    return available[0]



def build_plan_segment(trip: TrainTrip, board_index: int, alight_index: int, seat: SeatOption) -> PlanSegment:
    board_stop = trip.stops[board_index]
    alight_stop = trip.stops[alight_index]
    return PlanSegment(
        train_number=trip.train_number,
        board_station=board_stop.name,
        alight_station=alight_stop.name,
        depart_at=board_stop.depart_at,
        arrive_at=alight_stop.arrive_at,
        seat_type=seat.seat_type,
        price=seat.price,
    )
