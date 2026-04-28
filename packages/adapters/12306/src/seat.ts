import type { TicketPriceResponse } from './client';
import { SEAT_DEFINITIONS } from './constants';
import type { SeatPriceMap } from './types';

function parsePriceValue(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace('¥', '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function transformTicketPriceResponse(response: TicketPriceResponse): SeatPriceMap {
  const priceMap: SeatPriceMap = {};

  SEAT_DEFINITIONS.forEach((definition) => {
    const price = definition.priceKeys
      .map((key) => parsePriceValue(typeof response.data[key] === 'string' ? response.data[key] : undefined))
      .find((value) => value !== undefined);

    if (price !== undefined) {
      priceMap[definition.key] = price;
    }
  });

  return priceMap;
}
