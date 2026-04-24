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



def sleeper_priority_sort_key(plan: PurchasePlan) -> tuple[int, int, float, int]:
    return (
        -plan.sleeper_segment_count,
        plan.total_travel_minutes,
        plan.total_price,
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



def build_recommendations(plans: list[PurchasePlan]) -> tuple[list[PurchasePlan], dict[str, PurchasePlan]]:
    unique_plans = deduplicate_plans(plans)
    if not unique_plans:
        return [], {}

    shortest = min(unique_plans, key=plan_sort_key)
    cheapest = min(unique_plans, key=cheapest_plan_sort_key)

    recommendations = {
        RecommendationTag.SHORTEST_DURATION.value: shortest,
        RecommendationTag.CHEAPEST_PRICE.value: cheapest,
    }

    sleeper_candidates = [plan for plan in unique_plans if plan.sleeper_segment_count > 0]
    if sleeper_candidates:
        recommendations[RecommendationTag.SLEEPER_PRIORITY.value] = min(sleeper_candidates, key=sleeper_priority_sort_key)

    for plan in unique_plans:
        plan.recommendation_tags = []
    for tag, plan in recommendations.items():
        plan.recommendation_tags.append(RecommendationTag(tag))

    return sort_plans(unique_plans), recommendations
