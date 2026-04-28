import { HTTP_USER_AGENT } from './constants';
import type { StationDictionaryEntry } from './types';

const BASE_URL = import.meta.env?.DEV ? window.location.origin : 'https://kyfw.12306.cn';
const PATH_PREFIX = import.meta.env?.DEV ? '/12306' : '';
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

    const exact = stations.find((station) => normalize(station.name) === input || normalize(station.cityName) === input);
    if (exact) {
      return exact;
    }

    const fuzzy = stations.find((station) => {
      const stationName = normalize(station.name);
      const cityName = normalize(station.cityName);
      return stationName.includes(trimmedCity) || cityName.includes(trimmedCity);
    });

    if (!fuzzy) {
      throw new Error(`No station found for input: ${cityOrStationName}`);
    }

    return fuzzy;
  }
}
