from datetime import datetime

from app.models.domain import PlanStrategy, RecommendationTag, SeatOption, TrainStop, TrainTrip
from app.services.transfer_optimizer import find_best_transfer_plan, find_transfer_plans



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
    assert plan.strategy == PlanStrategy.TRANSFER
    assert plan.total_travel_minutes == 210
    assert plan.total_price == 160.0
    assert [segment.train_number for segment in plan.segments] == ["T1", "T2"]



def test_builds_multiple_recommendation_views():
    plans, recommendations, _ = find_transfer_plans(
        trips=build_trips(),
        departure_station="西安",
        arrival_station="十堰",
        min_transfer_minutes=20,
    )

    assert len(plans) >= 2
    assert recommendations["shortest_duration"].strategy == PlanStrategy.TRANSFER
    assert recommendations["cheapest_price"].strategy == PlanStrategy.DIRECT
    assert RecommendationTag.CHEAPEST_PRICE in recommendations["cheapest_price"].recommendation_tags



def test_omits_sleeper_priority_when_no_sleeper_plan_exists():
    plans, recommendations, _ = find_transfer_plans(
        trips=build_trips(),
        departure_station="西安",
        arrival_station="十堰",
        min_transfer_minutes=20,
    )

    assert len(plans) >= 2
    assert RecommendationTag.SLEEPER_PRIORITY.value not in recommendations



def test_sleeper_priority_prefers_shorter_purchased_ticket_over_cheaper_longer_one():
    sleeper_trip = TrainTrip(
        train_number="K2097",
        train_code="62000K209602",
        stops=[
            TrainStop(name="长沙", arrive_at=None, depart_at=datetime(2026, 5, 5, 14, 30)),
            TrainStop(name="十堰", arrive_at=datetime(2026, 5, 6, 1, 10), depart_at=datetime(2026, 5, 6, 1, 15)),
            TrainStop(name="西安", arrive_at=datetime(2026, 5, 6, 7, 7), depart_at=datetime(2026, 5, 6, 7, 29)),
            TrainStop(name="介休", arrive_at=datetime(2026, 5, 6, 14, 17), depart_at=datetime(2026, 5, 6, 14, 20)),
            TrainStop(name="阳曲", arrive_at=datetime(2026, 5, 6, 16, 39), depart_at=datetime(2026, 5, 6, 16, 44)),
            TrainStop(name="大同", arrive_at=datetime(2026, 5, 6, 22, 25), depart_at=None),
        ],
        seat_inventory={
            (1, 2): [SeatOption(seat_type="硬座", price=53.5, available=True, train_number="K2097")],
            (0, 3): [SeatOption(seat_type="硬卧", price=464.5, available=True, train_number="K2096")],
            (0, 4): [SeatOption(seat_type="硬卧", price=530.0, available=True, train_number="K2096")],
            (0, 5): [SeatOption(seat_type="硬卧", price=629.0, available=True, train_number="K2096")],
        },
    )

    plans, recommendations, _ = find_transfer_plans(
        trips=[sleeper_trip],
        departure_station="十堰",
        arrival_station="西安",
        min_transfer_minutes=20,
    )

    assert len(plans) >= 3
    sleeper_plan = recommendations[RecommendationTag.SLEEPER_PRIORITY.value]
    assert sleeper_plan.total_price == 464.5
    assert [(segment.train_number, segment.board_station, segment.alight_station, segment.seat_type) for segment in sleeper_plan.segments] == [
        ("K2096", "长沙", "介休", "硬卧")
    ]



def test_sleeper_priority_requires_every_segment_to_be_sleeper():
    mixed_trip = TrainTrip(
        train_number="T1",
        train_code="T1",
        stops=[
            TrainStop(name="西安", arrive_at=None, depart_at=datetime(2026, 5, 1, 20, 0)),
            TrainStop(name="安康", arrive_at=datetime(2026, 5, 1, 23, 0), depart_at=datetime(2026, 5, 1, 23, 20)),
            TrainStop(name="十堰", arrive_at=datetime(2026, 5, 2, 2, 0), depart_at=None),
        ],
        seat_inventory={
            (0, 1): [SeatOption(seat_type="硬卧", price=120.0, available=True)],
            (1, 2): [SeatOption(seat_type="硬座", price=60.0, available=True)],
        },
    )

    plans, recommendations, _ = find_transfer_plans(
        trips=[mixed_trip],
        departure_station="西安",
        arrival_station="十堰",
        min_transfer_minutes=20,
    )

    assert len(plans) >= 1
    assert RecommendationTag.SLEEPER_PRIORITY.value not in recommendations
