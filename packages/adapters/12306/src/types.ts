import type { QueryInput, TrainRecommendationContext } from '@train-ticket/core';

export interface QueryLeftTicketRow {
  rawFields: string[];
  secret: string;
  bookingStatus: string;
  trainNo: string;
  trainCode: string;
  startStationTelecode: string;
  endStationTelecode: string;
  fromStationTelecode: string;
  toStationTelecode: string;
  startTime: string;
  arriveTime: string;
  durationText: string;
  canWebBuy: string;
  saleStatus: string;
  trainDate: string;
  fromStationNo: string;
  toStationNo: string;
  seatTypeCandidates: string[];
  seatAvailabilityMap: Record<string, string>;
}

export interface StationDictionaryEntry {
  name: string;
  telecode: string;
  cityName: string;
  pinyin: string;
  abbreviation: string;
}

export interface TrainTicketQueryService {
  queryRecommendation(input: QueryInput): Promise<TrainRecommendationContext[]>;
}

export interface SeatPriceMap {
  swz?: number;
  tz?: number;
  zy?: number;
  ze?: number;
  gr?: number;
  rw?: number;
  yw?: number;
  yz?: number;
  wz?: number;
}
