import { HTTP_USER_AGENT } from './constants';
import { sleep } from './utils';

const IS_BROWSER = typeof window !== 'undefined';
const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
const BASE_URL = IS_DEV && IS_BROWSER ? window.location.origin : 'https://kyfw.12306.cn';
const PATH_PREFIX = IS_DEV ? '/12306' : '';
const INIT_URL = `${BASE_URL}${PATH_PREFIX}/otn/leftTicket/init?linktypeid=dc`;
const QUERY_URL = `${BASE_URL}${PATH_PREFIX}/otn/leftTicket/queryG`;
const ROUTE_URL = `${BASE_URL}${PATH_PREFIX}/otn/czxx/queryByTrainNo`;
const PRICE_URL = `${BASE_URL}${PATH_PREFIX}/otn/leftTicket/queryTicketPrice`;
const RETRYABLE_12306_RESPONSE_ERROR = '__12306_retryable_response__';
export const USER_FACING_12306_RESPONSE_ERROR = '12306 暂时未返回可解析的车票数据，请稍后重试';

export function isUserFacing12306ResponseError(error: unknown): boolean {
  return error instanceof Error && error.message === USER_FACING_12306_RESPONSE_ERROR;
}

function isHtmlDocument(value: string): boolean {
  const normalized = value.trimStart().toLowerCase();
  return normalized.startsWith('<!doctype html') || normalized.startsWith('<html');
}

function buildHeaders(cookieHeader?: string): HeadersInit {
  const headers: HeadersInit = {
    'User-Agent': HTTP_USER_AGENT,
    Referer: INIT_URL,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/javascript, */*; q=0.01',
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  return headers;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const normalizedText = text.replace(/^﻿/, '');

  if (isHtmlDocument(normalizedText)) {
    throw new Error(RETRYABLE_12306_RESPONSE_ERROR);
  }

  try {
    return JSON.parse(normalizedText) as T;
  } catch {
    throw new Error(RETRYABLE_12306_RESPONSE_ERROR);
  }
}

export interface LeftTicketQueryPayload {
  'leftTicketDTO.train_date': string;
  'leftTicketDTO.from_station': string;
  'leftTicketDTO.to_station': string;
  purpose_codes: 'ADULT';
}

export interface LeftTicketResponse {
  httpstatus: number;
  data: {
    result: string[];
    map: Record<string, string>;
  };
}

export interface TrainRouteResponse {
  status: boolean;
  httpstatus: number;
  data: {
    data: Array<{
      station_name: string;
      start_time: string;
      arrive_time: string;
      stopover_time: string;
      station_no: string;
    }>;
  };
}

export interface TicketPriceResponse {
  status: boolean;
  httpstatus: number;
  data: Record<string, string | string[]>;
}

export interface TicketPricePayload {
  train_no: string;
  from_station_no: string;
  to_station_no: string;
  seat_types: string;
  train_date: string;
}

export class Train12306HttpClient {
  private cookieHeader = '';
  private sessionPromise: Promise<void> | null = null;

  private updateCookies(response: Response): void {
    const rawCookies = response.headers.getSetCookie?.() ?? [];
    if (rawCookies.length === 0) {
      return;
    }

    const cookieMap = new Map<string, string>();
    this.cookieHeader
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        const [name, value] = item.split('=');
        if (name && value) {
          cookieMap.set(name, value);
        }
      });

    rawCookies.forEach((cookie) => {
      const [pair] = cookie.split(';');
      const [name, value] = pair.split('=');
      if (name && value) {
        cookieMap.set(name.trim(), value.trim());
      }
    });

    this.cookieHeader = [...cookieMap.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private resetSession(): void {
    this.cookieHeader = '';
    this.sessionPromise = null;
  }

  async initSession(): Promise<void> {
    if (this.cookieHeader) {
      return;
    }

    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const response = await fetch(INIT_URL, {
          headers: {
            'User-Agent': HTTP_USER_AGENT,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to initialize 12306 session: ${response.status}`);
        }

        this.updateCookies(response);
      })();
    }

    try {
      await this.sessionPromise;
    } catch (error) {
      this.resetSession();
      throw error;
    }
  }

  private async requestJson<T>(url: URL | string, errorPrefix: string, withAjaxHeaders = true): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.initSession();
      const response = await fetch(url, {
        headers: withAjaxHeaders
          ? buildHeaders(this.cookieHeader)
          : {
              'User-Agent': HTTP_USER_AGENT,
              ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
            },
      });

      this.updateCookies(response);

      try {
        if (!response.ok) {
          throw new Error(`${errorPrefix}: ${response.status}`);
        }

        return await parseJsonResponse<T>(response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const shouldRetry = attempt < 2 && message === RETRYABLE_12306_RESPONSE_ERROR;
        this.resetSession();
        if (!shouldRetry) {
          if (message === RETRYABLE_12306_RESPONSE_ERROR) {
            throw new Error(USER_FACING_12306_RESPONSE_ERROR);
          }
          throw error;
        }
        await sleep(300 * (attempt + 1));
      }
    }

    throw new Error(`${errorPrefix}: exhausted retries`);
  }

  async queryLeftTickets(payload: LeftTicketQueryPayload): Promise<LeftTicketResponse> {
    const url = new URL(QUERY_URL);
    Object.entries(payload).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return this.requestJson<LeftTicketResponse>(url, 'Left ticket query failed');
  }

  async queryTrainRoute(trainNo: string, fromStationTelecode: string, toStationTelecode: string, departDate: string): Promise<TrainRouteResponse> {
    const url = new URL(ROUTE_URL);
    url.searchParams.set('train_no', trainNo);
    url.searchParams.set('from_station_telecode', fromStationTelecode);
    url.searchParams.set('to_station_telecode', toStationTelecode);
    url.searchParams.set('depart_date', departDate);

    return this.requestJson<TrainRouteResponse>(url, 'Train route query failed', false);
  }

  async queryTicketPrice(payload: TicketPricePayload): Promise<TicketPriceResponse> {
    const url = new URL(PRICE_URL);
    Object.entries(payload).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return this.requestJson<TicketPriceResponse>(url, 'Ticket price query failed');
  }
}
