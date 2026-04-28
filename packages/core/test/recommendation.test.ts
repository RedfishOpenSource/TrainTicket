import { describe, expect, it } from 'vitest';
import {
  buildRouteSegment,
  createPurchaseSegments,
  mergeCandidates,
  rankCandidates,
  recommendBestOption,
  type TrainRecommendationContext,
} from '../src';

const routeStops = [
  { stationName: '始发站', stationTelecode: 'AAA', arriveTime: '----', departTime: '07:00' },
  { stationName: 'A城', stationTelecode: 'BBB', arriveTime: '08:00', departTime: '08:05' },
  { stationName: '中间站', stationTelecode: 'CCC', arriveTime: '10:00', departTime: '10:02' },
  { stationName: 'B城', stationTelecode: 'DDD', arriveTime: '12:00', departTime: '12:05' },
  { stationName: '终点站', stationTelecode: 'EEE', arriveTime: '13:00', departTime: '----' },
];

describe('query engine', () => {
  it('creates all purchase segments from C1 × C2', () => {
    const segments = createPurchaseSegments(1, 3, routeStops);
    expect(segments).toHaveLength(4);
    expect(segments[0].fromStop.stationName).toBe('始发站');
    expect(segments[0].toStop.stationName).toBe('B城');
  });

  it('keeps cheaper direct ticket on merge tie-breakers', () => {
    const merged = mergeCandidates([
      {
        trainNo: '1',
        trainCode: 'G1',
        actualFrom: 'A城',
        actualTo: 'B城',
        purchaseFrom: 'A城',
        purchaseTo: 'B城',
        actualRideDurationMinutes: 235,
        departureTime: '08:05',
        arrivalTime: '12:00',
        seatCategory: 'seat',
        seatLabel: '二等座',
        price: 100,
        sourceType: 'direct',
        purchaseStopCount: 2,
        isLongTrip: false,
        recommendationReason: '',
      },
      {
        trainNo: '1',
        trainCode: 'G1',
        actualFrom: 'A城',
        actualTo: 'B城',
        purchaseFrom: '始发站',
        purchaseTo: '终点站',
        actualRideDurationMinutes: 235,
        departureTime: '08:05',
        arrivalTime: '12:00',
        seatCategory: 'seat',
        seatLabel: '二等座',
        price: 100,
        sourceType: 'extended',
        purchaseStopCount: 4,
        isLongTrip: false,
        recommendationReason: '',
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].sourceType).toBe('direct');
  });

  it('ranks short trips before long trips and favors sleeper for long trips', () => {
    const ranked = rankCandidates([
      {
        trainNo: '2',
        trainCode: 'Z2',
        actualFrom: 'A城',
        actualTo: 'B城',
        purchaseFrom: 'A城',
        purchaseTo: 'B城',
        actualRideDurationMinutes: 500,
        departureTime: '08:05',
        arrivalTime: '18:00',
        seatCategory: 'seat',
        seatLabel: '二等座',
        price: 80,
        sourceType: 'direct',
        purchaseStopCount: 2,
        isLongTrip: true,
        recommendationReason: '',
      },
      {
        trainNo: '3',
        trainCode: 'Z3',
        actualFrom: 'A城',
        actualTo: 'B城',
        purchaseFrom: 'A城',
        purchaseTo: 'B城',
        actualRideDurationMinutes: 520,
        departureTime: '09:05',
        arrivalTime: '18:00',
        seatCategory: 'sleeper',
        seatLabel: '硬卧',
        price: 300,
        sourceType: 'direct',
        purchaseStopCount: 2,
        isLongTrip: true,
        recommendationReason: '',
      },
      {
        trainNo: '1',
        trainCode: 'G1',
        actualFrom: 'A城',
        actualTo: 'B城',
        purchaseFrom: 'A城',
        purchaseTo: 'B城',
        actualRideDurationMinutes: 200,
        departureTime: '07:05',
        arrivalTime: '10:25',
        seatCategory: 'seat',
        seatLabel: '二等座',
        price: 120,
        sourceType: 'direct',
        purchaseStopCount: 2,
        isLongTrip: false,
        recommendationReason: '',
      },
    ]);

    expect(ranked.map((item) => item.trainCode)).toEqual(['G1', 'Z3', 'Z2']);
  });

  it('returns the best option from recommendation contexts', () => {
    const actualSegment = buildRouteSegment(routeStops, 1, 3);
    const context: TrainRecommendationContext = {
      trainRoute: {
        trainNo: '100',
        trainCode: 'G100',
        routeStops,
        startStationTelecode: 'AAA',
        endStationTelecode: 'EEE',
        startStationName: '始发站',
        endStationName: '终点站',
      },
      actualSegment,
      purchaseAvailabilities: [
        {
          purchaseSegment: { fromStop: routeStops[1], toStop: routeStops[3], fromIndex: 1, toIndex: 3 },
          seatOptions: [{ seatLabel: '二等座', seatCode: 'ZE', countText: '5', price: 120 }],
          sleeperOptions: [],
        },
        {
          purchaseSegment: { fromStop: routeStops[0], toStop: routeStops[4], fromIndex: 0, toIndex: 4 },
          seatOptions: [{ seatLabel: '二等座', seatCode: 'ZE', countText: '3', price: 110 }],
          sleeperOptions: [],
        },
      ],
    };

    const result = recommendBestOption([context]);
    expect(result.bestOption?.price).toBe(110);
    expect(result.bestOption?.sourceType).toBe('extended');
  });
});
