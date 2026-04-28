import type { StationDictionaryEntry } from '@train-ticket/adapter-12306';
import {
  isAndroidNativeBridgeAvailable,
  loadStationSnapshotViaNativeBridge,
  refreshStationsViaNativeBridge,
} from '../plugins/ticketBridge';

const STATION_CACHE_KEY = 'train-ticket:station-cache:v2';
const STATION_CACHE_TTL = 24 * 60 * 60 * 1000;
const BROWSER_STATION_URL = '/12306/otn/resources/js/framework/station_name.js';

interface StationCachePayload {
  stations: StationDictionaryEntry[];
  updatedAt: number;
}

export interface StationSnapshot {
  stations: StationDictionaryEntry[];
  updatedAt: number | null;
  fromCache: boolean;
}

let inMemorySnapshot: StationSnapshot | null = null;
let inflightLoad: Promise<StationSnapshot> | null = null;

export async function loadStationSnapshot(): Promise<StationSnapshot> {
  if (inMemorySnapshot) {
    return inMemorySnapshot;
  }

  if (inflightLoad) {
    return inflightLoad;
  }

  inflightLoad = isAndroidNativeBridgeAvailable()
    ? loadAndroidStationSnapshot()
    : loadBrowserStationSnapshot();

  try {
    inMemorySnapshot = await inflightLoad;
    return inMemorySnapshot;
  } finally {
    inflightLoad = null;
  }
}

export function shouldRefreshStations(updatedAt: number | null, now = Date.now()): boolean {
  return updatedAt === null || now - updatedAt >= STATION_CACHE_TTL;
}

export async function refreshStationSnapshot(): Promise<StationSnapshot> {
  const snapshot = isAndroidNativeBridgeAvailable()
    ? await refreshAndroidStationSnapshot()
    : await refreshBrowserStationSnapshot();
  inMemorySnapshot = snapshot;
  return snapshot;
}

async function loadBrowserStationSnapshot(): Promise<StationSnapshot> {
  const cached = readBrowserCache();
  if (cached) {
    return {
      stations: cached.stations,
      updatedAt: cached.updatedAt,
      fromCache: true,
    };
  }

  return refreshBrowserStationSnapshot();
}

async function refreshBrowserStationSnapshot(): Promise<StationSnapshot> {
  const stations = await fetchBrowserStations();
  const snapshot = {
    stations,
    updatedAt: Date.now(),
  } satisfies StationCachePayload;
  writeBrowserCache(snapshot);
  return {
    stations: snapshot.stations,
    updatedAt: snapshot.updatedAt,
    fromCache: false,
  };
}

async function loadAndroidStationSnapshot(): Promise<StationSnapshot> {
  const snapshot = await loadStationSnapshotViaNativeBridge();
  if (snapshot.stations.length > 0 && shouldRefreshStations(snapshot.updatedAt)) {
    void refreshAndroidStationSnapshot().catch(() => undefined);
  }

  if (snapshot.stations.length > 0) {
    return snapshot;
  }

  return refreshAndroidStationSnapshot();
}

async function refreshAndroidStationSnapshot(): Promise<StationSnapshot> {
  return refreshStationsViaNativeBridge();
}

function readBrowserCache(): StationCachePayload | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(STATION_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const payload = JSON.parse(raw) as Partial<StationCachePayload>;
    if (!Array.isArray(payload.stations) || payload.stations.length === 0 || typeof payload.updatedAt !== 'number') {
      return null;
    }
    return {
      stations: payload.stations,
      updatedAt: payload.updatedAt,
    };
  } catch {
    return null;
  }
}

async function fetchBrowserStations(): Promise<StationDictionaryEntry[]> {
  const response = await fetch(BROWSER_STATION_URL);
  if (!response.ok) {
    throw new Error(`Failed to load station dictionary: ${response.status}`);
  }

  const script = await response.text();
  const matched = script.match(/var station_names ='([^']+)'/);
  if (!matched) {
    throw new Error('Failed to parse station dictionary payload');
  }

  return matched[1]
    .split('@')
    .filter(Boolean)
    .map((rawEntry) => {
      const [shortName, name, telecode, pinyin, abbreviation, , , cityName = name] = rawEntry.split('|');
      return {
        name,
        telecode,
        cityName,
        pinyin,
        abbreviation: shortName || abbreviation,
      } satisfies StationDictionaryEntry;
    });
}

function writeBrowserCache(snapshot: StationCachePayload): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STATION_CACHE_KEY, JSON.stringify(snapshot));
}
