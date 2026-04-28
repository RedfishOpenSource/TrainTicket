import { recommendBestOption, type QueryInput, type QueryRecommendationResult } from '@train-ticket/core';
import { Train12306QueryService } from './service';

const defaultService = new Train12306QueryService();

export async function queryBestRecommendation(
  input: QueryInput,
  service = defaultService,
): Promise<QueryRecommendationResult> {
  const contexts = await service.queryRecommendation(input);
  return recommendBestOption(contexts);
}
