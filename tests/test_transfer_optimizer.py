from datetime import datetime

from app.models.domain import PlanStrategy, SeatOption, TrainStop, TrainTrip
from app.services.transfer_optimizer import find_best_transfer_plan



def build_trips():
    return [
        TrainTrip(
            train_number="T1",
            train_code="T1",
            stops=[
                TrainStop(name="西安", arrive_at=None, depart_at=datetime(2026, 5, 1, 8, 0)),
                TrainStop(name="安康", arrive_at=datetime(2026, 5, 1, 9, 30), depart_at=datetime(2026, 5, 1, 9, 40)),
                TrainStop(name="达州", arrive_at=datetime(2026, 5, 1, 11, 0), depart_at=None),
            ],
            seat_inventory={
                (0, 1): [SeatOption(seat_type="二等座", price=90.0, available=True)],
                (1, 2): [SeatOption(seat_type="二等座", price=80.0, available=True)],
                (0, 2): [SeatOption(seat_type="二等座", price=200.0, available=False)],
            },
        ),
        TrainTrip(
            train_number="T2",
            train_code="T2",
            stops=[
                TrainStop(name="安康", arrive_at=None, depart_at=datetime(2026, 5, 1, 10, 0)),
                TrainStop(name="十堰", arrive_at=datetime(2026, 5, 1, 11, 30), depart_at=None),
            ],
            seat_inventory={
                (0, 1): [SeatOption(seat_type="二等座", price=70.0, available=True)],
            },
        ),
        TrainTrip(
            train_number="T3",
            train_code="T3",
            stops=[
                TrainStop(name="西安", arrive_at=None, depart_at=datetime(2026, 5, 1, 7, 0)),
                TrainStop(name="十堰", arrive_at=datetime(2026, 5, 1, 12, 30), depart_at=None),
            ],
            seat_inventory={
                (0, 1): [SeatOption(seat_type="硬座", price=100.0, available=True)],
            },
        ),
    ]



def test_prefers_shorter_total_travel_time_over_lower_price_when_no_direct_inventory_exists():
    trips = build_trips()
    trips[2].seat_inventory[(0, 1)] = [SeatOption(seat_type="硬座", price=100.0, available=False)]

    plan = find_best_transfer_plan(
        trips=trips,
        departure_station="西安",
        arrival_station="十堰",
        min_transfer_minutes=20,
    )

    assert plan is not None
    assert plan.strategy == PlanStrategy.TRANSFER
    assert plan.total_travel_minutes == 210
    assert plan.total_price == 160.0
    assert [segment.train_number for segment in plan.segments] == ["T1", "T2"]



def test_returns_transfer_plan_when_direct_route_is_unavailable():
    trips = build_trips()
    trips[2].seat_inventory[(0, 1)] = [SeatOption(seat_type="硬座", price=100.0, available=False)]

    plan = find_best_transfer_plan(
        trips=trips,
        departure_station="西安",
        arrival_station="十堰",
        min_transfer_minutes=20,
    )

    assert plan is not None
    assert plan.strategy == PlanStrategy.TRANSFER
    assert plan.total_travel_minutes == 210
    assert plan.total_price == 160.0
    assert [segment.train_number for segment in plan.segments] == ["T1", "T2"]



def test_prefers_direct_plan_over_more_complex_options_when_direct_inventory_exists():
    plan = find_best_transfer_plan(
        trips=build_trips(),
        departure_station="西安",
        arrival_station="十堰",
        min_transfer_minutes=20,
    )

    assert plan is not None
    assert plan.strategy == PlanStrategy.DIRECT
    assert plan.total_travel_minutes == 330
    assert plan.total_price == 100.0
    assert [segment.train_number for segment in plan.segments] == ["T3"]
