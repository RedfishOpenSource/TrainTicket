from typing import Any

from app.models.domain import PurchasePlan, RecommendationTag



def plan_sort_key(plan: PurchasePlan) -> tuple[int, float, int]:
    return (
        plan.total_travel_minutes,
        plan.total_price,
        plan.segment_count,
    )



def cheapest_plan_sort_key(plan: PurchasePlan) -> tuple[float, int, int]:
    return (
        plan.total_price,
        plan.total_travel_minutes,
        plan.segment_count,
    )



def _purchased_travel_minutes(plan: PurchasePlan) -> int:
    return sum(
        int((segment.arrive_at - segment.depart_at).total_seconds() // 60)
        for segment in plan.segments
    )



def _extra_purchased_minutes(plan: PurchasePlan) -> int:
    return max(0, _purchased_travel_minutes(plan) - plan.total_travel_minutes)



def _is_full_sleeper_plan(plan: PurchasePlan) -> bool:
    return bool(plan.segments) and all("卧" in segment.seat_type for segment in plan.segments)



def sleeper_priority_sort_key(plan: PurchasePlan) -> tuple[int, int, float, int, int]:
    return (
        _extra_purchased_minutes(plan),
        _purchased_travel_minutes(plan),
        plan.total_price,
        plan.total_travel_minutes,
        plan.segment_count,
    )



def sort_plans(plans: list[PurchasePlan]) -> list[PurchasePlan]:
    return sorted(plans, key=plan_sort_key)



def deduplicate_plans(plans: list[PurchasePlan]) -> list[PurchasePlan]:
    unique: dict[tuple, PurchasePlan] = {}
    for plan in plans:
        signature = plan.signature()
        existing = unique.get(signature)
        if existing is None or plan_sort_key(plan) < plan_sort_key(existing):
            unique[signature] = plan
    return list(unique.values())



def build_recommendations(plans: list[PurchasePlan]) -> tuple[list[PurchasePlan], dict[str, PurchasePlan], dict[str, list[PurchasePlan]]]:
    unique_plans = deduplicate_plans(plans)
    if not unique_plans:
        return [], {}, {}

    shortest = min(unique_plans, key=plan_sort_key)
    cheapest = min(unique_plans, key=cheapest_plan_sort_key)

    recommendations = {
        RecommendationTag.SHORTEST_DURATION.value: shortest,
        RecommendationTag.CHEAPEST_PRICE.value: cheapest,
    }

    candidate_groups: dict[str, list[PurchasePlan]] = {
        RecommendationTag.SHORTEST_DURATION.value: sorted(unique_plans, key=plan_sort_key),
        RecommendationTag.CHEAPEST_PRICE.value: sorted(unique_plans, key=cheapest_plan_sort_key),
    }

    sleeper_candidates = [plan for plan in unique_plans if _is_full_sleeper_plan(plan)]
    if sleeper_candidates:
        recommendations[RecommendationTag.SLEEPER_PRIORITY.value] = min(sleeper_candidates, key=sleeper_priority_sort_key)
        candidate_groups[RecommendationTag.SLEEPER_PRIORITY.value] = sorted(sleeper_candidates, key=cheapest_plan_sort_key)
    else:
        candidate_groups[RecommendationTag.SLEEPER_PRIORITY.value] = []

    for plan in unique_plans:
        plan.recommendation_tags = []
    for tag, plan in recommendations.items():
        plan.recommendation_tags.append(RecommendationTag(tag))

    return sort_plans(unique_plans), recommendations, candidate_groups
