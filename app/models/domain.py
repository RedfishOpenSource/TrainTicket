from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Any


@dataclass(slots=True)
class TrainStop:
    name: str
    arrive_at: datetime | None
    depart_at: datetime | None


@dataclass(slots=True)
class SeatOption:
    seat_type: str
    price: float
    available: bool


@dataclass(slots=True)
class TrainTrip:
    train_number: str
    train_code: str
    stops: list[TrainStop]
    seat_inventory: dict[tuple[int, int], list[SeatOption]]
    travel_date: date | None = None

    def station_index(self, station_name: str) -> int:
        for index, stop in enumerate(self.stops):
            if stop.name == station_name:
                return index
        raise ValueError(f"Unknown station: {station_name}")


@dataclass(slots=True)
class PlanSegment:
    train_number: str
    board_station: str
    alight_station: str
    depart_at: datetime
    arrive_at: datetime
    seat_type: str
    price: float

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["depart_at"] = self.depart_at.isoformat()
        payload["arrive_at"] = self.arrive_at.isoformat()
        return payload


class PlanStrategy(str, Enum):
    DIRECT = "direct"
    BUY_LONGER = "buy_longer"
    SPLIT_TICKET = "split_ticket"
    TRANSFER = "transfer"


@dataclass(slots=True)
class PurchasePlan:
    strategy: PlanStrategy
    total_travel_minutes: int
    total_price: float
    segments: list[PlanSegment]
    purchase_steps: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def train_numbers(self) -> list[str]:
        return [segment.train_number for segment in self.segments]

    @property
    def seat_types(self) -> list[str]:
        return [segment.seat_type for segment in self.segments]

    @property
    def segment_count(self) -> int:
        return len(self.segments)

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy": self.strategy.value,
            "total_travel_minutes": self.total_travel_minutes,
            "total_price": self.total_price,
            "segments": [segment.to_dict() for segment in self.segments],
            "train_numbers": self.train_numbers,
            "seat_types": self.seat_types,
            "purchase_steps": list(self.purchase_steps),
            "warnings": list(self.warnings),
        }
