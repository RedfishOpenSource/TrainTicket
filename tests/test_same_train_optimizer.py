from datetime import datetime

from app.models.domain import PlanSegment, PlanStrategy, PurchasePlan, SeatOption, TrainStop, TrainTrip
from app.services.same_train_optimizer import find_best_same_train_plan



def build_trip() -> TrainTrip:
    return TrainTrip(
        train_number="K1",
        train_code="240000K10000",
        stops=[
            TrainStop(name="大同", arrive_at=None, depart_at=datetime(2026, 4, 30, 8, 0)),
            TrainStop(name="西安", arrive_at=datetime(2026, 5, 1, 8, 0), depart_at=datetime(2026, 5, 1, 8, 5)),
            TrainStop(name="安康", arrive_at=datetime(2026, 5, 1, 10, 0), depart_at=datetime(2026, 5, 1, 10, 5)),
            TrainStop(name="十堰", arrive_at=datetime(2026, 5, 1, 12, 0), depart_at=datetime(2026, 5, 1, 12, 5)),
            TrainStop(name="长沙", arrive_at=datetime(2026, 5, 1, 18, 0), depart_at=None),
        ],
        seat_inventory={
            (0, 4): [SeatOption(seat_type="硬卧", price=420.0, available=True)],
            (1, 2): [SeatOption(seat_type="硬座", price=80.0, available=True)],
            (2, 3): [SeatOption(seat_type="硬座", price=50.0, available=True)],
            (1, 3): [SeatOption(seat_type="硬座", price=120.0, available=False)],
            (0, 3): [SeatOption(seat_type="硬卧", price=260.0, available=True)],
        },
    )



def test_prefers_buy_longer_ticket_when_direct_segment_sold_out_and_split_unavailable():
    trip = build_trip()
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=50.0, available=False)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert isinstance(plan, PurchasePlan)
    assert plan.strategy == "buy_longer"
    assert plan.total_travel_minutes == 235
    assert plan.total_price == 260.0
    assert [(segment.board_station, segment.alight_station) for segment in plan.segments] == [("大同", "十堰")]



def test_falls_back_to_split_segments_when_buy_longer_not_available():
    trip = build_trip()
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=False)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan.strategy == "split_ticket"
    assert plan.total_price == 130.0
    assert [(segment.board_station, segment.alight_station) for segment in plan.segments] == [("西安", "安康"), ("安康", "十堰")]



def test_uses_shortest_actual_travel_time_then_lowest_price_for_same_train_options():
    trip = build_trip()
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=True)]
    trip.seat_inventory[(0, 4)] = [SeatOption(seat_type="硬卧", price=200.0, available=True)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan.strategy == "split_ticket"
    assert plan.total_travel_minutes == 235
    assert plan.total_price == 130.0



def test_buy_longer_uses_actual_requested_segment_travel_time_for_ranking():
    trip = build_trip()
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=50.0, available=False)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan.strategy == "buy_longer"
    assert plan.total_travel_minutes == 235
    assert plan.total_price == 260.0



def test_returns_none_when_only_later_boarding_segments_have_inventory():
    trip = build_trip()
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=False)]
    trip.seat_inventory[(0, 4)] = [SeatOption(seat_type="硬卧", price=420.0, available=False)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=50.0, available=False)]
    trip.seat_inventory[(2, 4)] = [SeatOption(seat_type="硬座", price=120.0, available=True)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is None



def test_prefers_direct_plan_when_requested_segment_has_inventory():
    trip = build_trip()
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="硬座", price=120.0, available=True)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=40.0, available=True)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=40.0, available=True)]
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="无座", price=90.0, available=True)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is not None
    assert plan.strategy == PlanStrategy.DIRECT
    assert plan.total_travel_minutes == 235
    assert plan.total_price == 120.0
    assert [(segment.board_station, segment.alight_station) for segment in plan.segments] == [("西安", "十堰")]
