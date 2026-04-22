from app.models.domain import PurchasePlan



def sort_plans(plans: list[PurchasePlan]) -> list[PurchasePlan]:
    return sorted(
        plans,
        key=lambda plan: (
            plan.total_travel_minutes,
            plan.total_price,
            plan.segment_count,
        ),
    )
