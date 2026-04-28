import type {
  PurchaseAvailability,
  PurchaseSegment,
  QueryInput,
  RouteStop,
  SeatAvailability,
  TrainRecommendationContext,
  TrainRoute,
} from '@train-ticket/core';
import { buildRouteSegment, buildStopTimeline, createPurchaseSegments } from '@train-ticket/core';
import { SEAT_DEFINITIONS } from './constants';
import type { LeftTicketResponse, TrainRouteResponse } from './client';
import type { QueryLeftTicketRow, SeatPriceMap } from './types';

const RESULT_INDEX = {
  secret: 0,
  bookingStatus: 1,
  trainNo: 2,
  trainCode: 3,
  startStationTelecode: 4,
  endStationTelecode: 5,
  fromStationTelecode: 6,
  toStationTelecode: 7,
  startTime: 8,
  arriveTime: 9,
  durationText: 10,
  canWebBuy: 11,
  saleStatus: 12,
  trainDate: 13,
  fromStationNo: 16,
  toStationNo: 17,
  yz: 26,
  yw: 27,
  rw: 28,
  gr: 29,
  ze: 30,
  zy: 31,
  swz: 32,
  seatTypesPrimary: 33,
  seatTypesFallback: 34,
  ypInfoNew: 38,
};

function normalizeCountText(value: string): string {
  return value.replace(/\|/g, '').trim();
}

function hasAvailability(value: string): boolean {
  const normalized = normalizeCountText(value);
  return normalized !== '' && normalized !== '--' && normalized !== '无' && normalized !== '0';
}

export function createStationNameToTelecodeMap(stationMap: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(stationMap).map(([telecode, name]) => [name, telecode]));
}

export function parseLeftTicketRows(response: LeftTicketResponse): QueryLeftTicketRow[] {
  return response.data.result
    .map((row) => row.split('|'))
    .filter((row) => row.length > RESULT_INDEX.ypInfoNew)
    .map((rawFields) => ({
      rawFields,
      secret: rawFields[RESULT_INDEX.secret] ?? '',
      bookingStatus: rawFields[RESULT_INDEX.bookingStatus] ?? '',
      trainNo: rawFields[RESULT_INDEX.trainNo] ?? '',
      trainCode: rawFields[RESULT_INDEX.trainCode] ?? '',
      startStationTelecode: rawFields[RESULT_INDEX.startStationTelecode] ?? '',
      endStationTelecode: rawFields[RESULT_INDEX.endStationTelecode] ?? '',
      fromStationTelecode: rawFields[RESULT_INDEX.fromStationTelecode] ?? '',
      toStationTelecode: rawFields[RESULT_INDEX.toStationTelecode] ?? '',
      startTime: rawFields[RESULT_INDEX.startTime] ?? '',
      arriveTime: rawFields[RESULT_INDEX.arriveTime] ?? '',
      durationText: rawFields[RESULT_INDEX.durationText] ?? '',
      canWebBuy: rawFields[RESULT_INDEX.canWebBuy] ?? '',
      saleStatus: rawFields[RESULT_INDEX.saleStatus] ?? '',
      trainDate: rawFields[RESULT_INDEX.trainDate] ?? '',
      fromStationNo: rawFields[RESULT_INDEX.fromStationNo] ?? '',
      toStationNo: rawFields[RESULT_INDEX.toStationNo] ?? '',
      seatTypeCandidates: [rawFields[RESULT_INDEX.seatTypesFallback] ?? '', rawFields[RESULT_INDEX.seatTypesPrimary] ?? ''].filter(Boolean),
      seatAvailabilityMap: {
        swz: normalizeCountText(rawFields[RESULT_INDEX.swz] ?? '--'),
        zy: normalizeCountText(rawFields[RESULT_INDEX.zy] ?? '--'),
        ze: normalizeCountText(rawFields[RESULT_INDEX.ze] ?? '--'),
        gr: normalizeCountText(rawFields[RESULT_INDEX.gr] ?? '--'),
        rw: normalizeCountText(rawFields[RESULT_INDEX.rw] ?? '--'),
        yw: normalizeCountText(rawFields[RESULT_INDEX.yw] ?? '--'),
        yz: normalizeCountText(rawFields[RESULT_INDEX.yz] ?? '--'),
      },
    }));
}

export function transformRouteResponse(routeResponse: TrainRouteResponse, stationNameToTelecodeMap: Record<string, string>): RouteStop[] {
  return routeResponse.data.data.map((stop) => ({
    stationName: stop.station_name,
    stationTelecode: stationNameToTelecodeMap[stop.station_name] ?? stop.station_name,
    arriveTime: stop.arrive_time,
    departTime: stop.start_time,
    stopoverTime: stop.stopover_time,
  }));
}

export function buildTrainRoute(row: QueryLeftTicketRow, routeStops: RouteStop[], stationMap: Record<string, string>): TrainRoute {
  return {
    trainNo: row.trainNo,
    trainCode: row.trainCode,
    routeStops,
    startStationTelecode: row.startStationTelecode,
    endStationTelecode: row.endStationTelecode,
    startStationName: stationMap[row.startStationTelecode] ?? routeStops[0]?.stationName ?? '',
    endStationName: stationMap[row.endStationTelecode] ?? routeStops.at(-1)?.stationName ?? '',
  };
}

export function findActualSegment(input: QueryInput, row: QueryLeftTicketRow, routeStops: RouteStop[], stationMap: Record<string, string>) {
  const departureStationName = stationMap[row.fromStationTelecode] ?? input.departureCity;
  const arrivalStationName = stationMap[row.toStationTelecode] ?? input.arrivalCity;
  const fromIndex = routeStops.findIndex((stop) => stop.stationName === departureStationName);
  const toIndex = routeStops.findIndex((stop) => stop.stationName === arrivalStationName);

  if (fromIndex < 0 || toIndex < 0 || fromIndex >= toIndex) {
    return null;
  }

  return buildRouteSegment(routeStops, fromIndex, toIndex);
}

export function buildPurchaseAvailability(
  purchaseSegment: PurchaseSegment,
  priceMap: SeatPriceMap,
  seatAvailabilityMap: QueryLeftTicketRow['seatAvailabilityMap'],
): PurchaseAvailability {
  const seatOptions: SeatAvailability[] = [];
  const sleeperOptions: SeatAvailability[] = [];

  SEAT_DEFINITIONS.forEach((definition) => {
    const countText = seatAvailabilityMap[definition.key] ?? '--';
    const price = priceMap[definition.key];
    if (!hasAvailability(countText) || price === undefined) {
      return;
    }

    const option: SeatAvailability = {
      seatLabel: definition.label,
      seatCode: definition.seatCode,
      countText,
      price,
    };

    if (definition.category === 'seat') {
      seatOptions.push(option);
    } else {
      sleeperOptions.push(option);
    }
  });

  return {
    purchaseSegment,
    seatOptions,
    sleeperOptions,
  };
}

export function buildPurchaseSeatType(
  timeline: ReturnType<typeof buildStopTimeline>,
  purchaseSegment: PurchaseSegment,
  seatTypeCandidates: string[],
): string {
  const durationMinutes = timeline[purchaseSegment.toIndex].arrive - timeline[purchaseSegment.fromIndex].depart;
  const primary = seatTypeCandidates.find((candidate) => candidate.length > 0);

  if (primary) {
    return primary;
  }

  if (durationMinutes > 330) {
    return 'MO31';
  }

  return '9MO';
}

export function buildRecommendationContext(
  trainRoute: TrainRoute,
  actualSegment: ReturnType<typeof buildRouteSegment>,
  purchaseAvailabilities: PurchaseAvailability[],
): TrainRecommendationContext {
  return {
    trainRoute,
    actualSegment,
    purchaseAvailabilities,
  };
}

export function createPurchaseSegmentsForActualSegment(actualSegment: ReturnType<typeof buildRouteSegment>, routeStops: RouteStop[]): PurchaseSegment[] {
  return createPurchaseSegments(actualSegment.fromIndex, actualSegment.toIndex, routeStops);
}
