from datetime import datetime

from app.models.domain import PlanStrategy, RecommendationTag, SeatOption, TrainStop, TrainTrip
from app.services.ranking import build_recommendations
from app.services.same_train_optimizer import find_best_same_train_plan, find_same_train_plans
from app.services.transfer_optimizer import find_best_transfer_plan, find_transfer_plans


def _trip(train_number, stops, seat_inventory):
    return TrainTrip(
        train_number=train_number,
        train_code=train_number,
        stops=stops,
        seat_inventory=seat_inventory,
    )


def _stop(name, depart_at=None, arrive_at=None):
    return TrainStop(name=name, arrive_at=arrive_at, depart_at=depart_at)


def build_same_train_trip() -> TrainTrip:
    return _trip(
        "K2098",
        [
            _stop("大同", depart_at=datetime(2026, 4, 30, 14, 42)),
            _stop("西安", arrive_at=datetime(2026, 5, 1, 5, 31), depart_at=datetime(2026, 5, 1, 5, 52)),
            _stop("安康", arrive_at=datetime(2026, 5, 1, 9, 1), depart_at=datetime(2026, 5, 1, 9, 21)),
            _stop("十堰", arrive_at=datetime(2026, 5, 1, 12, 21), depart_at=datetime(2026, 5, 1, 12, 24)),
            _stop("长沙", arrive_at=datetime(2026, 5, 1, 22, 38)),
        ],
        {
            (0, 4): [SeatOption(seat_type="硬卧", price=420.0, available=True)],
            (1, 3): [SeatOption(seat_type="硬座", price=120.0, available=False)],
            (0, 3): [SeatOption(seat_type="硬卧", price=260.0, available=True)],
            (1, 2): [SeatOption(seat_type="硬座", price=80.0, available=True)],
            (2, 3): [SeatOption(seat_type="硬座", price=50.0, available=True)],
        },
    )


def build_transfer_trips() -> list[TrainTrip]:
    return [
        _trip(
            "T1",
            [
                _stop("西安", depart_at=datetime(2026, 5, 1, 8, 0)),
                _stop("安康", arrive_at=datetime(2026, 5, 1, 9, 30), depart_at=datetime(2026, 5, 1, 9, 40)),
                _stop("达州", arrive_at=datetime(2026, 5, 1, 11, 0)),
            ],
            {
                (0, 1): [SeatOption(seat_type="二等座", price=90.0, available=True)],
                (1, 2): [SeatOption(seat_type="二等座", price=80.0, available=True)],
                (0, 2): [SeatOption(seat_type="二等座", price=200.0, available=False)],
            },
        ),
        _trip(
            "T2",
            [
                _stop("安康", depart_at=datetime(2026, 5, 1, 10, 0)),
                _stop("十堰", arrive_at=datetime(2026, 5, 1, 11, 30)),
            ],
            {
                (0, 1): [SeatOption(seat_type="二等座", price=70.0, available=True)],
            },
        ),
        _trip(
            "T3",
            [
                _stop("西安", depart_at=datetime(2026, 5, 1, 7, 0)),
                _stop("十堰", arrive_at=datetime(2026, 5, 1, 12, 30)),
            ],
            {
                (0, 1): [SeatOption(seat_type="硬座", price=100.0, available=True)],
            },
        ),
    ]


def test_case_1_direct_ticket_available_returns_direct_candidate():
    trip = build_same_train_trip()
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="硬座", price=120.0, available=True)]
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=False)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=50.0, available=False)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is not None
    assert plan.strategy == PlanStrategy.DIRECT
    assert plan.total_travel_minutes == 389
    assert plan.total_price == 120.0


def test_case_2_buy_longer_is_available_when_direct_is_sold_out():
    trip = build_same_train_trip()
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="硬座", price=120.0, available=False)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=50.0, available=False)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is not None
    assert plan.strategy == PlanStrategy.BUY_LONGER
    assert plan.purchase_steps[-1] == "实际乘坐区间为 西安 到 十堰"
    assert plan.total_travel_minutes == 389


def test_case_3_split_ticket_is_available_when_same_train_segments_exist():
    trip = build_same_train_trip()
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=False)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is not None
    assert plan.strategy == PlanStrategy.SPLIT_TICKET
    assert plan.total_price == 130.0
    assert len(plan.purchase_steps) == 2


def test_case_4_only_later_boarding_inventory_is_not_valid():
    trip = build_same_train_trip()
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=False)]
    trip.seat_inventory[(0, 4)] = [SeatOption(seat_type="硬卧", price=420.0, available=False)]
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="硬座", price=120.0, available=False)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="无座", price=32.5, available=True)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is None


def test_case_5_same_train_candidates_follow_duration_then_price_then_segments():
    trip = build_same_train_trip()
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="硬座", price=120.0, available=True)]
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=True)]
    trip.seat_inventory[(0, 4)] = [SeatOption(seat_type="硬卧", price=200.0, available=True)]

    plans = find_same_train_plans(trip, "西安", "十堰")

    assert plans[0].strategy == PlanStrategy.DIRECT
    assert plans[0].total_price == 120.0
    assert any(plan.strategy == PlanStrategy.BUY_LONGER for plan in plans)
    assert any(plan.strategy == PlanStrategy.SPLIT_TICKET for plan in plans)


def test_case_6_transfer_is_returned_when_same_train_options_are_unavailable():
    trips = build_transfer_trips()
    trips[2].seat_inventory[(0, 1)] = [SeatOption(seat_type="硬座", price=100.0, available=False)]

    plan = find_best_transfer_plan(trips, "西安", "十堰", min_transfer_minutes=20)

    assert plan is not None
    assert plan.strategy == PlanStrategy.TRANSFER
    assert [segment.train_number for segment in plan.segments] == ["T1", "T2"]
    assert plan.total_price == 160.0


def test_case_7_returns_no_plan_when_everything_is_unavailable():
    trips = build_transfer_trips()
    trips[0].seat_inventory[(0, 1)] = [SeatOption(seat_type="二等座", price=90.0, available=False)]
    trips[0].seat_inventory[(1, 2)] = [SeatOption(seat_type="二等座", price=80.0, available=False)]
    trips[2].seat_inventory[(0, 1)] = [SeatOption(seat_type="硬座", price=100.0, available=False)]

    plans, recommendations = find_transfer_plans(trips, "西安", "十堰", min_transfer_minutes=20)

    assert plans == []
    assert recommendations == {}


def test_case_8_cross_day_train_uses_actual_boarding_day_duration():
    trip = build_same_train_trip()

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is not None
    assert plan.total_travel_minutes == 389
    assert plan.segments[0].depart_at.date().isoformat() == "2026-05-01"


def test_case_9_waitlist_is_not_treated_as_available_inventory():
    trips = build_transfer_trips()
    trips[2].seat_inventory[(0, 1)] = [SeatOption(seat_type="硬座", price=100.0, available=False)]
    trips[0].seat_inventory[(0, 1)] = [SeatOption(seat_type="二等座", price=90.0, available=False)]
    trips[1].seat_inventory[(0, 1)] = [SeatOption(seat_type="二等座", price=70.0, available=False)]

    plans, _ = find_transfer_plans(trips, "西安", "十堰", min_transfer_minutes=20)

    assert plans == []


def test_case_10_no_seat_is_a_valid_option():
    trip = build_same_train_trip()
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="无座", price=53.5, available=True)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=50.0, available=False)]
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=False)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is not None
    assert plan.strategy == PlanStrategy.DIRECT
    assert plan.segments[0].seat_type == "无座"
    assert plan.total_price == 53.5


def test_case_11_recommendations_keep_multiple_seat_preferences():
    direct_trip = _trip(
        "Z1",
        [
            _stop("西安", depart_at=datetime(2026, 5, 1, 20, 0)),
            _stop("十堰", arrive_at=datetime(2026, 5, 2, 6, 0)),
        ],
        {
            (0, 1): [
                SeatOption(seat_type="无座", price=40.0, available=True),
                SeatOption(seat_type="硬卧", price=120.0, available=True),
            ],
        },
    )
    transfer_trip_a = _trip(
        "D1",
        [
            _stop("西安", depart_at=datetime(2026, 5, 1, 8, 0)),
            _stop("安康", arrive_at=datetime(2026, 5, 1, 9, 20), depart_at=datetime(2026, 5, 1, 9, 40)),
        ],
        {(0, 1): [SeatOption(seat_type="二等座", price=60.0, available=True)]},
    )
    transfer_trip_b = _trip(
        "D2",
        [
            _stop("安康", depart_at=datetime(2026, 5, 1, 10, 10)),
            _stop("十堰", arrive_at=datetime(2026, 5, 1, 11, 20)),
        ],
        {(0, 1): [SeatOption(seat_type="二等座", price=50.0, available=True)]},
    )

    plans, recommendations = find_transfer_plans(
        [direct_trip, transfer_trip_a, transfer_trip_b],
        "西安",
        "十堰",
        min_transfer_minutes=20,
    )

    assert len(plans) >= 3
    assert recommendations[RecommendationTag.SHORTEST_DURATION.value].strategy == PlanStrategy.TRANSFER
    assert recommendations[RecommendationTag.CHEAPEST_PRICE.value].total_price == 40.0
    assert recommendations[RecommendationTag.SLEEPER_PRIORITY.value].segments[0].seat_type == "硬卧"


def test_case_12_same_physical_train_matching_is_stable_by_train_code():
    trip = build_same_train_trip()
    trip.train_number = "K2095"
    trip.train_code = "K2098_SHARED"

    plans = find_same_train_plans(trip, "西安", "十堰")

    assert plans
    assert any(segment.train_number == "K2095" for plan in plans for segment in plan.segments)


def test_case_k1_covering_tickets_are_recognized_for_k2098():
    trip = build_same_train_trip()
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="硬座", price=120.0, available=False)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=50.0, available=False)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is not None
    assert plan.strategy == PlanStrategy.BUY_LONGER
    assert plan.segments[0].board_station == "大同"


def test_case_k2_later_station_inventory_is_not_misclassified_for_k2098():
    trip = build_same_train_trip()
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="硬座", price=120.0, available=False)]
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="硬卧", price=260.0, available=False)]
    trip.seat_inventory[(0, 4)] = [SeatOption(seat_type="硬卧", price=420.0, available=False)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="无座", price=32.5, available=True)]

    plan = find_best_same_train_plan(trip, "西安", "十堰")

    assert plan is None


def test_case_k3_multiple_covering_tickets_pick_best_candidate_under_sort_rules():
    trip = build_same_train_trip()
    trip.seat_inventory[(1, 3)] = [SeatOption(seat_type="硬座", price=120.0, available=False)]
    trip.seat_inventory[(1, 2)] = [SeatOption(seat_type="硬座", price=80.0, available=False)]
    trip.seat_inventory[(2, 3)] = [SeatOption(seat_type="硬座", price=50.0, available=False)]
    trip.seat_inventory[(0, 3)] = [SeatOption(seat_type="无座", price=243.5, available=True)]
    trip.seat_inventory[(0, 4)] = [SeatOption(seat_type="硬座", price=220.0, available=True)]

    plans = find_same_train_plans(trip, "西安", "十堰")
    sorted_plans, recommendations = build_recommendations(plans)

    assert sorted_plans[0].strategy == PlanStrategy.BUY_LONGER
    assert recommendations[RecommendationTag.CHEAPEST_PRICE.value].total_price == 220.0
