import { buildStopTimeline, type PurchaseSegment, type QueryInput, type TrainRecommendationContext } from '@train-ticket/core';
import { Train12306HttpClient } from './client';
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

function toTrainDate(trainDate: string): string {
  return `${trainDate.slice(0, 4)}-${trainDate.slice(4, 6)}-${trainDate.slice(6, 8)}`;
}

export class Train12306QueryService implements TrainTicketQueryService {
  constructor(
    private readonly stationDictionary = new StationDictionary(),
    private readonly client = new Train12306HttpClient(),
  ) {}

  private async fetchPurchaseAvailability(
    row: QueryLeftTicketRow,
    trainDate: string,
    timeline: ReturnType<typeof buildStopTimeline>,
    purchaseSegment: PurchaseSegment,
  ) {
    const seatTypes = buildPurchaseSeatType(timeline, purchaseSegment, row.seatTypeCandidates);
    const priceResponse = await this.client.queryTicketPrice({
      train_no: row.trainNo,
      from_station_no: formatStationNo(purchaseSegment.fromIndex),
      to_station_no: formatStationNo(purchaseSegment.toIndex),
      seat_types: seatTypes,
      train_date: trainDate,
    });

    return buildPurchaseAvailability(purchaseSegment, transformTicketPriceResponse(priceResponse), row.seatAvailabilityMap);
  }

  async queryRecommendation(input: QueryInput): Promise<TrainRecommendationContext[]> {
    const [departureStation, arrivalStation] = await Promise.all([
      this.stationDictionary.resolveStation(input.departureCity),
      this.stationDictionary.resolveStation(input.arrivalCity),
    ]);

    const leftTicketResponse = await this.client.queryLeftTickets({
      'leftTicketDTO.train_date': input.travelDate,
      'leftTicketDTO.from_station': departureStation.telecode,
      'leftTicketDTO.to_station': arrivalStation.telecode,
      purpose_codes: 'ADULT',
    });

    const stationNameToTelecodeMap = createStationNameToTelecodeMap(leftTicketResponse.data.map);
    const rows = parseLeftTicketRows(leftTicketResponse).filter((row) => row.canWebBuy === 'Y');
    const contexts = await mapWithConcurrency(rows, TRAIN_CONCURRENCY, async (row) => {
      const trainDate = toTrainDate(row.trainDate);
      const routeResponse = await this.client.queryTrainRoute(
        row.trainNo,
        row.fromStationTelecode,
        row.toStationTelecode,
        trainDate,
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
        (purchaseSegment) => this.fetchPurchaseAvailability(row, trainDate, timeline, purchaseSegment),
      );

      return buildRecommendationContext(trainRoute, actualSegment, purchaseAvailabilities);
    });

    return contexts.filter((context): context is TrainRecommendationContext => context !== null);
  }
}
