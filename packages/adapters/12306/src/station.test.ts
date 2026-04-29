import { describe, expect, it } from 'vitest';
import { StationDictionary } from './station';
import type { StationDictionaryEntry } from './types';

class TestStationDictionary extends StationDictionary {
  constructor(private readonly testStations: StationDictionaryEntry[]) {
    super();
  }

  override async load(): Promise<StationDictionaryEntry[]> {
    return this.testStations;
  }
}

const stations: StationDictionaryEntry[] = [
  {
    name: '西安北',
    telecode: 'EAY',
    cityName: '西安',
    pinyin: 'xianbei',
    abbreviation: 'xab',
  },
  {
    name: '西安',
    telecode: 'XAY',
    cityName: '西安',
    pinyin: 'xian',
    abbreviation: 'xan',
  },
  {
    name: '十堰',
    telecode: 'SNN',
    cityName: '十堰',
    pinyin: 'shiyan',
    abbreviation: 'sya',
  },
];

describe('StationDictionary.resolveStation', () => {
  it('prefers exact station name over city name matches', async () => {
    const dictionary = new TestStationDictionary(stations);

    await expect(dictionary.resolveStation('西安')).resolves.toMatchObject({
      name: '西安',
      telecode: 'XAY',
    });
  });

  it('keeps suffix-stripped city input resolving to the canonical station', async () => {
    const dictionary = new TestStationDictionary(stations);

    await expect(dictionary.resolveStation('西安市')).resolves.toMatchObject({
      name: '西安',
      telecode: 'XAY',
    });
  });

  it('still resolves exact sub-station names precisely', async () => {
    const dictionary = new TestStationDictionary(stations);

    await expect(dictionary.resolveStation('西安北')).resolves.toMatchObject({
      name: '西安北',
      telecode: 'EAY',
    });
  });

  it('keeps fuzzy fallback behavior for partial matches', async () => {
    const dictionary = new TestStationDictionary(stations);

    await expect(dictionary.resolveStation('十')).resolves.toMatchObject({
      name: '十堰',
      telecode: 'SNN',
    });
  });
});
