export const HTTP_USER_AGENT = 'Mozilla/5.0';

export const SEAT_DEFINITIONS = [
  { key: 'swz', label: '商务座', seatCode: '9', priceKeys: ['A9', '9'], category: 'seat' },
  { key: 'zy', label: '一等座', seatCode: 'M', priceKeys: ['M'], category: 'seat' },
  { key: 'ze', label: '二等座', seatCode: 'O', priceKeys: ['O'], category: 'seat' },
  { key: 'yz', label: '硬座', seatCode: '1', priceKeys: ['A1', '1'], category: 'seat' },
  { key: 'gr', label: '高级软卧', seatCode: '6', priceKeys: ['A6', '6'], category: 'sleeper' },
  { key: 'rw', label: '软卧', seatCode: '4', priceKeys: ['A4', '4'], category: 'sleeper' },
  { key: 'yw', label: '硬卧', seatCode: '3', priceKeys: ['A3', '3'], category: 'sleeper' },
] as const;
