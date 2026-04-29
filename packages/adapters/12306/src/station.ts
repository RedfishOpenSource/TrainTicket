import { HTTP_USER_AGENT } from './constants';
import type { StationDictionaryEntry } from './types';

const IS_BROWSER = typeof window !== 'undefined';
const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
const BASE_URL = IS_DEV && IS_BROWSER ? window.location.origin : 'https://kyfw.12306.cn';
const PATH_PREFIX = IS_DEV ? '/12306' : '';
const STATION_URL = `${BASE_URL}${PATH_PREFIX}/otn/resources/js/framework/station_name.js`;

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function stripCitySuffix(value: string): string {
  return value.replace(/[市县区盟州旗乡镇村]$/u, '');
}

export class StationDictionary {
  private stations: StationDictionaryEntry[] | null = null;
  private stationsPromise: Promise<StationDictionaryEntry[]> | null = null;

  async load(): Promise<StationDictionaryEntry[]> {
    if (this.stations) {
      return this.stations;
    }

    if (this.stationsPromise) {
      return this.stationsPromise;
    }

    this.stationsPromise = (async () => {
      const response = await fetch(STATION_URL, {
        headers: typeof window === 'undefined'
          ? {
              'User-Agent': HTTP_USER_AGENT,
            }
          : undefined,
      });

    if (!response.ok) {
      throw new Error(`Failed to load station dictionary: ${response.status}`);
    }

    const script = await response.text();
    const matched = script.match(/var station_names ='([^']+)'/);
    if (!matched) {
      throw new Error('Failed to parse station dictionary payload');
    }

      this.stations = matched[1]
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

      return this.stations;
    })();

    try {
      return await this.stationsPromise;
    } finally {
      this.stationsPromise = null;
    }
  }

  async resolveStation(cityOrStationName: string): Promise<StationDictionaryEntry> {
    const stations = await this.load();
    const input = normalize(cityOrStationName);
    const trimmedCity = normalize(stripCitySuffix(cityOrStationName));

    const exactStation = stations.find((station) => normalize(station.name) === input);
    if (exactStation) {
      return exactStation;
    }

    const exactCity = stations.find((station) => normalize(station.cityName) === input);
    if (exactCity) {
      return exactCity;
    }

    if (trimmedCity !== input) {
      const trimmedExactStation = stations.find((station) => normalize(station.name) === trimmedCity);
      if (trimmedExactStation) {
        return trimmedExactStation;
      }

      const trimmedExactCity = stations.find((station) => normalize(station.cityName) === trimmedCity);
      if (trimmedExactCity) {
        return trimmedExactCity;
      }
    }

    const fuzzyStation = stations.find((station) => normalize(station.name).includes(trimmedCity));
    if (fuzzyStation) {
      return fuzzyStation;
    }

    const fuzzyCity = stations.find((station) => normalize(station.cityName).includes(trimmedCity));
    if (fuzzyCity) {
      return fuzzyCity;
    }

    throw new Error(`No station found for input: ${cityOrStationName}`);
  }
}
