import type {
  CandidateOption,
  PurchaseAvailability,
  PurchaseSegment,
  SeatAvailability,
  TrainRecommendationContext,
} from '../types';

function buildRecommendationReason(candidate: CandidateOption): string {
  if (!candidate.isLongTrip) {
    return candidate.sourceType === 'direct'
      ? '短途优先且价格更低，直达更省心'
      : '短途优先且价格更低，买长坐短更划算';
  }

  if (candidate.seatCategory === 'sleeper') {
    return candidate.sourceType === 'direct'
      ? '长途优先卧铺，直达乘坐更舒适'
      : '长途优先卧铺，买长坐短可保留舒适性';
  }

  return candidate.sourceType === 'direct'
    ? '长途仅剩坐席时优先直达方案'
    : '长途仅剩坐席时保留可行的买长坐短方案';
}

function buildCandidate(
  context: TrainRecommendationContext,
  purchaseAvailability: PurchaseAvailability,
  seatOption: SeatAvailability,
  seatCategory: CandidateOption['seatCategory'],
): CandidateOption {
  const sourceType =
    context.actualSegment.fromIndex === purchaseAvailability.purchaseSegment.fromIndex &&
    context.actualSegment.toIndex === purchaseAvailability.purchaseSegment.toIndex
      ? 'direct'
      : 'extended';

  const candidate: CandidateOption = {
    trainNo: context.trainRoute.trainNo,
    trainCode: context.trainRoute.trainCode,
    actualFrom: context.actualSegment.fromStop.stationName,
    actualTo: context.actualSegment.toStop.stationName,
    purchaseFrom: purchaseAvailability.purchaseSegment.fromStop.stationName,
    purchaseTo: purchaseAvailability.purchaseSegment.toStop.stationName,
    actualRideDurationMinutes: context.actualSegment.durationMinutes,
    departureTime: context.actualSegment.departureTime,
    arrivalTime: context.actualSegment.arrivalTime,
    seatCategory,
    seatLabel: seatOption.seatLabel,
    price: seatOption.price,
    sourceType,
    purchaseStopCount: purchaseAvailability.purchaseSegment.toIndex - purchaseAvailability.purchaseSegment.fromIndex,
    isLongTrip: context.actualSegment.durationMinutes > 330,
    recommendationReason: '',
  };

  candidate.recommendationReason = buildRecommendationReason(candidate);
  return candidate;
}

function findCheapestSeatOption(seatOptions: SeatAvailability[]): SeatAvailability | null {
  let cheapest: SeatAvailability | null = null;

  seatOptions.forEach((seatOption) => {
    if (!cheapest || seatOption.price < cheapest.price) {
      cheapest = seatOption;
    }
  });

  return cheapest;
}

function pushCheapestCandidate(
  target: CandidateOption[],
  context: TrainRecommendationContext,
  purchaseAvailability: PurchaseAvailability,
  seatOptions: SeatAvailability[],
  seatCategory: CandidateOption['seatCategory'],
): void {
  const cheapest = findCheapestSeatOption(seatOptions);
  if (!cheapest) {
    return;
  }

  target.push(buildCandidate(context, purchaseAvailability, cheapest, seatCategory));
}

export function createPurchaseSegments(fromIndex: number, toIndex: number, routeStops: TrainRecommendationContext['trainRoute']['routeStops']): PurchaseSegment[] {
  const segments: PurchaseSegment[] = [];

  for (let left = 0; left <= fromIndex; left += 1) {
    for (let right = toIndex; right < routeStops.length; right += 1) {
      if (left < right) {
        segments.push({
          fromStop: routeStops[left],
          toStop: routeStops[right],
          fromIndex: left,
          toIndex: right,
        });
      }
    }
  }

  return segments;
}

export function generateCandidates(contexts: TrainRecommendationContext[]): CandidateOption[] {
  const candidates: CandidateOption[] = [];

  contexts.forEach((context) => {
    context.purchaseAvailabilities.forEach((purchaseAvailability) => {
      pushCheapestCandidate(candidates, context, purchaseAvailability, purchaseAvailability.seatOptions, 'seat');
      pushCheapestCandidate(candidates, context, purchaseAvailability, purchaseAvailability.sleeperOptions, 'sleeper');
    });
  });

  return candidates;
}
