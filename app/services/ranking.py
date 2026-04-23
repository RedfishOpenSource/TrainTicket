from app.models.domain import PurchasePlan



def plan_sort_key(plan: PurchasePlan) -> tuple[int, float, int]:
    return (
        plan.total_travel_minutes,
        plan.total_price,
        plan.segment_count,
    )



def sort_plans(plans: list[PurchasePlan]) -> list[PurchasePlan]:
    return sorted(plans, key=plan_sort_key)
