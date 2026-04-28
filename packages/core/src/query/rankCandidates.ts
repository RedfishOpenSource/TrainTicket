import type { CandidateOption } from '../types';

function compareShortTrip(left: CandidateOption, right: CandidateOption): number {
  if (left.price !== right.price) {
    return left.price - right.price;
  }

  if (left.sourceType !== right.sourceType) {
    return left.sourceType === 'direct' ? -1 : 1;
  }

  if (left.actualRideDurationMinutes !== right.actualRideDurationMinutes) {
    return left.actualRideDurationMinutes - right.actualRideDurationMinutes;
  }

  return left.departureTime.localeCompare(right.departureTime);
}

function compareLongTrip(left: CandidateOption, right: CandidateOption): number {
  if (left.seatCategory !== right.seatCategory) {
    return left.seatCategory === 'sleeper' ? -1 : 1;
  }

  if (left.actualRideDurationMinutes !== right.actualRideDurationMinutes) {
    return left.actualRideDurationMinutes - right.actualRideDurationMinutes;
  }

  if (left.sourceType !== right.sourceType) {
    return left.sourceType === 'direct' ? -1 : 1;
  }

  if (left.departureTime !== right.departureTime) {
    return left.departureTime.localeCompare(right.departureTime);
  }

  return left.price - right.price;
}

export function rankCandidates(candidates: CandidateOption[]): CandidateOption[] {
  return [...candidates].sort((left, right) => {
    if (left.isLongTrip !== right.isLongTrip) {
      return left.isLongTrip ? 1 : -1;
    }

    if (!left.isLongTrip) {
      return compareShortTrip(left, right);
    }

    return compareLongTrip(left, right);
  });
}
