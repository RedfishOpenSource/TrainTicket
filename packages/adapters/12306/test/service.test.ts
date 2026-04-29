import { describe, expect, it, vi } from 'vitest';
import { recommendBestOption, type QueryInput } from '@train-ticket/core';
import type { LeftTicketQueryPayload, LeftTicketResponse, TicketPricePayload, TicketPriceResponse, TrainRouteResponse } from '../src/client';
import { Train12306QueryService } from '../src/service';

const stationMap = {
  AAA: '始发站',
  SYN: '十堰',
  XAY: '西安',
  DTV: '大同',
};

function createLeftTicketRow(options: {
  trainNo: string;
  trainCode: string;
  trainDate: string;
  fromTelecode: string;
  toTelecode: string;
  seatAvailability?: Partial<Record<'swz' | 'zy' | 'ze' | 'gr' | 'rw' | 'yw' | 'yz', string>>;
}): string {
  const fields = Array.from({ length: 39 }, () => '');
  fields[2] = options.trainNo;
  fields[3] = options.trainCode;
  fields[4] = 'AAA';
  fields[5] = 'DTV';
  fields[6] = options.fromTelecode;
  fields[7] = options.toTelecode;
  fields[8] = '06:40';
  fields[9] = '12:40';
  fields[10] = '06:00';
  fields[11] = 'Y';
  fields[13] = options.trainDate.replace(/-/g, '');
  fields[16] = '02';
  fields[17] = '03';
  fields[26] = options.seatAvailability?.yz ?? '--';
  fields[27] = options.seatAvailability?.yw ?? '--';
  fields[28] = options.seatAvailability?.rw ?? '--';
  fields[29] = options.seatAvailability?.gr ?? '--';
  fields[30] = options.seatAvailability?.ze ?? '--';
  fields[31] = options.seatAvailability?.zy ?? '--';
  fields[32] = options.seatAvailability?.swz ?? '--';
  fields[34] = 'MO31';
  fields[38] = 'YP';
  return fields.join('|');
}

function createLeftTicketResponse(rows: string[]): LeftTicketResponse {
  return {
    httpstatus: 200,
    data: {
      result: rows,
      map: stationMap,
    },
  };
}

const routeResponse: TrainRouteResponse = {
  status: true,
  httpstatus: 200,
  data: {
    data: [
      { station_name: '始发站', start_time: '23:30', arrive_time: '----', stopover_time: '----', station_no: '01' },
      { station_name: '十堰', start_time: '06:40', arrive_time: '06:30', stopover_time: '10分', station_no: '02' },
      { station_name: '西安', start_time: '12:50', arrive_time: '12:40', stopover_time: '10分', station_no: '03' },
      { station_name: '大同', start_time: '----', arrive_time: '20:00', stopover_time: '----', station_no: '04' },
    ],
  },
};

function createPriceResponse(data: Record<string, string>): TicketPriceResponse {
  return {
    status: true,
    httpstatus: 200,
    data,
  };
}

describe('Train12306QueryService', () => {
  it('uses previous-day purchase segment availability so long-trip sleeper can win', async () => {
    const input: QueryInput = {
      travelDate: '2026-05-06',
      departureCity: '十堰',
      arrivalCity: '西安',
    };

    const directRow = createLeftTicketRow({
      trainNo: '2400000K2096',
      trainCode: 'K2096',
      trainDate: '2026-05-06',
      fromTelecode: 'SYN',
      toTelecode: 'XAY',
      seatAvailability: { ze: '5' },
    });

    const extendedSleeperRow = createLeftTicketRow({
      trainNo: '2400000K2096',
      trainCode: 'K2096',
      trainDate: '2026-05-05',
      fromTelecode: 'AAA',
      toTelecode: 'DTV',
      seatAvailability: { ze: '5', yw: '2' },
    });

    const stationDictionary = {
      resolveStation: vi.fn(async (city: string) => {
        if (city === '十堰') {
          return { name: '十堰', telecode: 'SYN', cityName: '十堰', pinyin: 'shiyan', abbreviation: 'sy' };
        }
        if (city === '西安') {
          return { name: '西安', telecode: 'XAY', cityName: '西安', pinyin: 'xian', abbreviation: 'xa' };
        }
        throw new Error(`unexpected city: ${city}`);
      }),
    };

    const queryLeftTickets = vi.fn(async (payload: LeftTicketQueryPayload) => {
      const key = `${payload['leftTicketDTO.train_date']}|${payload['leftTicketDTO.from_station']}|${payload['leftTicketDTO.to_station']}`;
      if (key === '2026-05-06|SYN|XAY') {
        return createLeftTicketResponse([directRow]);
      }
      if (key === '2026-05-05|AAA|DTV') {
        return createLeftTicketResponse([extendedSleeperRow]);
      }
      return createLeftTicketResponse([]);
    });

    const queryTicketPrice = vi.fn(async (payload: TicketPricePayload) => {
      const key = `${payload.train_date}|${payload.from_station_no}|${payload.to_station_no}`;
      if (key === '2026-05-06|02|03') {
        return createPriceResponse({ O: '80' });
      }
      if (key === '2026-05-05|01|04') {
        return createPriceResponse({ O: '120', A3: '300' });
      }
      return createPriceResponse({});
    });

    const client = {
      queryLeftTickets,
      queryTrainRoute: vi.fn(async () => routeResponse),
      queryTicketPrice,
    };

    const service = new Train12306QueryService(stationDictionary as never, client as never);
    const contexts = await service.queryRecommendation(input);
    const result = recommendBestOption(contexts);

    expect(queryLeftTickets).toHaveBeenCalledWith({
      'leftTicketDTO.train_date': '2026-05-05',
      'leftTicketDTO.from_station': 'AAA',
      'leftTicketDTO.to_station': 'DTV',
      purpose_codes: 'ADULT',
    });
    expect(result.bestOption?.trainCode).toBe('K2096');
    expect(result.bestOption?.seatCategory).toBe('sleeper');
    expect(result.bestOption?.purchaseFrom).toBe('始发站');
    expect(result.bestOption?.purchaseTo).toBe('大同');
    expect(result.bestOption?.actualRideDurationMinutes).toBeGreaterThan(330);
  });
});
