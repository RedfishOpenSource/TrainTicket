import { queryBestRecommendation } from '@train-ticket/adapter-12306';
import type { QueryInput, QueryRecommendationResult } from '@train-ticket/core';
import {
  isAndroidNativeBridgeAvailable,
  queryRecommendationViaNativeBridge,
} from '../plugins/ticketBridge';

async function queryRecommendationViaDevServer(input: QueryInput): Promise<QueryRecommendationResult> {
  const response = await fetch('/__dev/query-best-ticket', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? `Dev query failed: ${response.status}`);
  }

  return (await response.json()) as QueryRecommendationResult;
}

export async function queryBestTicket(input: QueryInput): Promise<QueryRecommendationResult> {
  if (isAndroidNativeBridgeAvailable()) {
    return queryRecommendationViaNativeBridge(input);
  }

  if (import.meta.env.DEV) {
    return queryRecommendationViaDevServer(input);
  }

  return queryBestRecommendation(input);
}
