import type { CandidateOption } from '../types';

function compareMergePriority(left: CandidateOption, right: CandidateOption): number {
  if (left.price !== right.price) {
    return left.price - right.price;
  }

  if (left.sourceType !== right.sourceType) {
    return left.sourceType === 'direct' ? -1 : 1;
  }

  if (left.purchaseStopCount !== right.purchaseStopCount) {
    return left.purchaseStopCount - right.purchaseStopCount;
  }

  return left.departureTime.localeCompare(right.departureTime);
}

export function mergeCandidates(candidates: CandidateOption[]): CandidateOption[] {
  const merged = new Map<string, Map<string, Map<string, Map<CandidateOption['seatCategory'], CandidateOption>>>>();

  candidates.forEach((candidate) => {
    const byTrain = merged.get(candidate.trainNo) ?? new Map();
    const byFrom = byTrain.get(candidate.actualFrom) ?? new Map();
    const byTo = byFrom.get(candidate.actualTo) ?? new Map();
    const current = byTo.get(candidate.seatCategory);

    if (!current || compareMergePriority(candidate, current) < 0) {
      byTo.set(candidate.seatCategory, candidate);
    }

    byFrom.set(candidate.actualTo, byTo);
    byTrain.set(candidate.actualFrom, byFrom);
    merged.set(candidate.trainNo, byTrain);
  });

  return [...merged.values()].flatMap((byFrom) =>
    [...byFrom.values()].flatMap((byTo) => [...byTo.values()].flatMap((bySeat) => [...bySeat.values()])),
  );
}
