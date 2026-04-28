import type { StationDictionaryEntry } from '@train-ticket/adapter-12306';

const HOT_STATION_NAMES = ['北京', '上海', '广州', '天津', '重庆', '成都', '杭州', '西安', '长沙', '哈尔滨'];

export interface StationPickerItem {
  station: StationDictionaryEntry;
  displayName: string;
  cityValue: string;
  searchText: string;
  indexLetter: string;
}

export interface StationPickerGroup {
  letter: string;
  items: StationPickerItem[];
}

export interface StationPickerDataset {
  hotStations: StationPickerItem[];
  groups: StationPickerGroup[];
  indexLetters: string[];
}

export function buildStationPickerDataset(stations: StationDictionaryEntry[]): StationPickerDataset {
  const items = buildStationPickerItems(stations);
  const groupsMap = new Map<string, StationPickerItem[]>();

  for (const item of items) {
    const group = groupsMap.get(item.indexLetter) ?? [];
    group.push(item);
    groupsMap.set(item.indexLetter, group);
  }

  const groups = [...groupsMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([letter, groupItems]) => ({
      letter,
      items: groupItems.sort(compareStationPickerItems),
    }));

  const hotStations = HOT_STATION_NAMES
    .map((name) => items.find((item) => item.displayName === name || item.cityValue === name))
    .filter((item): item is StationPickerItem => Boolean(item));

  return {
    hotStations,
    groups,
    indexLetters: groups.map((group) => group.letter),
  };
}

export function searchStationPickerItems(
  groups: StationPickerGroup[],
  keyword: string,
): StationPickerItem[] {
  const normalizedKeyword = normalize(keyword);
  if (!normalizedKeyword) {
    return [];
  }

  return groups
    .flatMap((group) => group.items)
    .filter((item) => item.searchText.includes(normalizedKeyword))
    .sort((left, right) => compareSearchPriority(left, right, normalizedKeyword));
}

function buildStationPickerItems(stations: StationDictionaryEntry[]): StationPickerItem[] {
  const cityMap = new Map<string, StationPickerItem>();

  for (const station of stations) {
    const cityValue = station.cityName || station.name;
    const searchTokens = [station.name, cityValue, station.pinyin, station.abbreviation]
      .map((value) => normalize(value))
      .filter(Boolean);
    const current = cityMap.get(cityValue);

    if (!current) {
      cityMap.set(cityValue, {
        station,
        displayName: cityValue,
        cityValue,
        searchText: searchTokens.join('|'),
        indexLetter: getIndexLetter(station),
      });
      continue;
    }

    current.searchText = [current.searchText, ...searchTokens].join('|');
  }

  return [...cityMap.values()];
}

function compareStationPickerItems(left: StationPickerItem, right: StationPickerItem): number {
  return left.displayName.localeCompare(right.displayName, 'zh-Hans-CN');
}

function compareSearchPriority(left: StationPickerItem, right: StationPickerItem, keyword: string): number {
  const leftRank = getMatchRank(left, keyword);
  const rightRank = getMatchRank(right, keyword);

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return compareStationPickerItems(left, right);
}

function getMatchRank(item: StationPickerItem, keyword: string): number {
  const name = normalize(item.displayName);
  const pinyin = normalize(item.station.pinyin);
  const abbreviation = normalize(item.station.abbreviation);

  if (name === keyword) {
    return 0;
  }
  if (name.startsWith(keyword)) {
    return 1;
  }
  if (pinyin.startsWith(keyword)) {
    return 2;
  }
  if (abbreviation.startsWith(keyword)) {
    return 3;
  }
  return 4;
}

function getIndexLetter(station: StationDictionaryEntry): string {
  const token = station.pinyin || station.abbreviation || station.name;
  const matched = token.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(matched) ? matched : '#';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}
