import {
  buildStopTimeline,
  type PurchaseAvailability,
  type PurchaseSegment,
  type QueryInput,
  type RouteSegment,
  type TrainRecommendationContext,
} from '@train-ticket/core';
import { isUserFacing12306ResponseError, Train12306HttpClient } from './client';
import { transformTicketPriceResponse } from './seat';
import { StationDictionary } from './station';
import {
  buildPurchaseAvailability,
  buildPurchaseSeatType,
  buildRecommendationContext,
  buildTrainRoute,
  createPurchaseSegmentsForActualSegment,
  createStationNameToTelecodeMap,
  findActualSegment,
  parseLeftTicketRows,
  transformRouteResponse,
} from './transformers';
import type { QueryLeftTicketRow, TrainTicketQueryService } from './types';
import { formatStationNo, mapWithConcurrency } from './utils';

const TRAIN_CONCURRENCY = 1;
const SEGMENT_CONCURRENCY = 2;
const MINUTES_PER_DAY = 24 * 60;

function toTrainDate(trainDate: string): string {
  return `${trainDate.slice(0, 4)}-${trainDate.slice(4, 6)}-${trainDate.slice(6, 8)}`;
}

function addDays(date: string, days: number): string {
  const target = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(target.valueOf())) {
    throw new Error(`Invalid date value: ${date}`);
  }

  target.setUTCDate(target.getUTCDate() + days);
  return target.toISOString().slice(0, 10);
}

function getStopServiceDay(timeline: ReturnType<typeof buildStopTimeline>, stopIndex: number): number {
  return Math.floor(timeline[stopIndex].depart / MINUTES_PER_DAY);
}

function resolveSegmentTravelDate(
  serviceDate: string,
  timeline: ReturnType<typeof buildStopTimeline>,
  segment: PurchaseSegment | RouteSegment,
): string {
  return addDays(serviceDate, getStopServiceDay(timeline, segment.fromIndex));
}

function createEmptyPurchaseAvailability(purchaseSegment: PurchaseSegment): PurchaseAvailability {
  return {
    purchaseSegment,
    seatOptions: [],
    sleeperOptions: [],
  };
}

export class Train12306QueryService implements TrainTicketQueryService {
  constructor(
    private readonly stationDictionary = new StationDictionary(),
    private readonly client = new Train12306HttpClient(),
  ) {}

  private async queryPurchaseSegmentRow(
    row: QueryLeftTicketRow,
    purchaseSegment: PurchaseSegment,
    purchaseTravelDate: string,
  ): Promise<QueryLeftTicketRow | null> {
    const response = await this.client.queryLeftTickets({
      'leftTicketDTO.train_date': purchaseTravelDate,
      'leftTicketDTO.from_station': purchaseSegment.fromStop.stationTelecode,
      'leftTicketDTO.to_station': purchaseSegment.toStop.stationTelecode,
      purpose_codes: 'ADULT',
    });

    return (
      parseLeftTicketRows(response).find(
        (candidate) => candidate.trainNo === row.trainNo && candidate.canWebBuy === 'Y',
      ) ?? null
    );
  }

  private async fetchPurchaseAvailability(
    row: QueryLeftTicketRow,
    serviceDate: string,
    timeline: ReturnType<typeof buildStopTimeline>,
    purchaseSegment: PurchaseSegment,
  ): Promise<PurchaseAvailability> {
    try {
      const purchaseTravelDate = resolveSegmentTravelDate(serviceDate, timeline, purchaseSegment);
      const purchaseRow = await this.queryPurchaseSegmentRow(row, purchaseSegment, purchaseTravelDate);
      if (!purchaseRow) {
        return createEmptyPurchaseAvailability(purchaseSegment);
      }

      const seatTypes = buildPurchaseSeatType(timeline, purchaseSegment, purchaseRow.seatTypeCandidates);
      const priceResponse = await this.client.queryTicketPrice({
        train_no: purchaseRow.trainNo,
        from_station_no: formatStationNo(purchaseSegment.fromIndex),
        to_station_no: formatStationNo(purchaseSegment.toIndex),
        seat_types: seatTypes,
        train_date: purchaseTravelDate,
      });

      return buildPurchaseAvailability(
        purchaseSegment,
        transformTicketPriceResponse(priceResponse),
        purchaseRow.seatAvailabilityMap,
      );
    } catch (error) {
      if (isUserFacing12306ResponseError(error)) {
        return createEmptyPurchaseAvailability(purchaseSegment);
      }
      throw error;
    }
  }

  async queryRecommendation(input: QueryInput): Promise<TrainRecommendationContext[]> {
    const [departureStation, arrivalStation, stationEntries] = await Promise.all([
      this.stationDictionary.resolveStation(input.departureCity),
      this.stationDictionary.resolveStation(input.arrivalCity),
      this.stationDictionary.load(),
    ]);

    const leftTicketResponse = await this.client.queryLeftTickets({
      'leftTicketDTO.train_date': input.travelDate,
      'leftTicketDTO.from_station': departureStation.telecode,
      'leftTicketDTO.to_station': arrivalStation.telecode,
      purpose_codes: 'ADULT',
    });

    const stationNameToTelecodeMap = createStationNameToTelecodeMap(leftTicketResponse.data.map, stationEntries);
    const rows = parseLeftTicketRows(leftTicketResponse).filter((row) => row.canWebBuy === 'Y');
    const contexts = await mapWithConcurrency(rows, TRAIN_CONCURRENCY, async (row) => {
      try {
        const serviceDate = toTrainDate(row.trainDate);
        const routeResponse = await this.client.queryTrainRoute(
          row.trainNo,
          row.fromStationTelecode,
          row.toStationTelecode,
          serviceDate,
        );
        const routeStops = transformRouteResponse(routeResponse, stationNameToTelecodeMap);
        const actualSegment = findActualSegment(input, row, routeStops, leftTicketResponse.data.map);
        if (!actualSegment) {
          return null;
        }

        const trainRoute = buildTrainRoute(row, routeStops, leftTicketResponse.data.map);
        const purchaseSegments = createPurchaseSegmentsForActualSegment(actualSegment, routeStops);
        const timeline = buildStopTimeline(routeStops);
        const purchaseAvailabilities = await mapWithConcurrency(
          purchaseSegments,
          SEGMENT_CONCURRENCY,
          (purchaseSegment) => this.fetchPurchaseAvailability(row, serviceDate, timeline, purchaseSegment),
        );

        return buildRecommendationContext(trainRoute, actualSegment, purchaseAvailabilities);
      } catch (error) {
        if (isUserFacing12306ResponseError(error)) {
          return null;
        }
        throw error;
      }
    });

    return contexts.filter((context): context is TrainRecommendationContext => context !== null);
  }
}
