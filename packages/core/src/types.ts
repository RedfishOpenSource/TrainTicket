export type SeatCategory = 'seat' | 'sleeper';
export type CandidateSourceType = 'direct' | 'extended';

export interface QueryInput {
  travelDate: string;
  departureCity: string;
  arrivalCity: string;
}

export interface StationRef {
  name: string;
  telecode: string;
}

export interface RouteStop {
  stationName: string;
  stationTelecode: string;
  arriveTime: string;
  departTime: string;
  stopoverTime?: string;
}

export interface TrainRoute {
  trainNo: string;
  trainCode: string;
  routeStops: RouteStop[];
  startStationTelecode: string;
  endStationTelecode: string;
  startStationName: string;
  endStationName: string;
}

export interface RouteSegment {
  fromStop: RouteStop;
  toStop: RouteStop;
  fromIndex: number;
  toIndex: number;
  durationMinutes: number;
  departureTime: string;
  arrivalTime: string;
}

export interface PurchaseSegment {
  fromStop: RouteStop;
  toStop: RouteStop;
  fromIndex: number;
  toIndex: number;
}

export interface SeatAvailability {
  seatLabel: string;
  seatCode: string;
  countText: string;
  price: number;
}

export interface PurchaseAvailability {
  purchaseSegment: PurchaseSegment;
  seatOptions: SeatAvailability[];
  sleeperOptions: SeatAvailability[];
}

export interface TrainRecommendationContext {
  trainRoute: TrainRoute;
  actualSegment: RouteSegment;
  purchaseAvailabilities: PurchaseAvailability[];
}

export interface CandidateOption {
  trainNo: string;
  trainCode: string;
  actualFrom: string;
  actualTo: string;
  purchaseFrom: string;
  purchaseTo: string;
  actualRideDurationMinutes: number;
  departureTime: string;
  arrivalTime: string;
  seatCategory: SeatCategory;
  seatLabel: string;
  price: number;
  sourceType: CandidateSourceType;
  purchaseStopCount: number;
  isLongTrip: boolean;
  recommendationReason: string;
}

export interface QueryRecommendationResult {
  bestOption: CandidateOption | null;
  candidates: CandidateOption[];
}
