import { Capacitor, registerPlugin } from '@capacitor/core';
import type { QueryInput, QueryRecommendationResult } from '@train-ticket/core';

export interface NativeStationOption {
  cityName: string;
  name: string;
  telecode: string;
  pinyin: string;
  abbreviation: string;
}

export interface NativeStationSnapshot {
  stations: NativeStationOption[];
  updatedAt: number | null;
  fromCache: boolean;
}

interface TicketBridgePlugin {
  queryRecommendation(input: QueryInput): Promise<QueryRecommendationResult>;
  loadStationSnapshot(): Promise<NativeStationSnapshot>;
  refreshStations(): Promise<NativeStationSnapshot>;
}

const ticketBridge = registerPlugin<TicketBridgePlugin>('TicketBridge');

export function isAndroidNativeBridgeAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export async function queryRecommendationViaNativeBridge(
  input: QueryInput,
): Promise<QueryRecommendationResult> {
  return ticketBridge.queryRecommendation(input);
}

export async function loadStationSnapshotViaNativeBridge(): Promise<NativeStationSnapshot> {
  return ticketBridge.loadStationSnapshot();
}

export async function refreshStationsViaNativeBridge(): Promise<NativeStationSnapshot> {
  return ticketBridge.refreshStations();
}
