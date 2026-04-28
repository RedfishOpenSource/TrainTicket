import { generateCandidates } from './generateCandidates';
import { mergeCandidates } from './mergeCandidates';
import { rankCandidates } from './rankCandidates';
import type { QueryRecommendationResult, TrainRecommendationContext } from '../types';

export function recommendBestOption(contexts: TrainRecommendationContext[]): QueryRecommendationResult {
  const candidates = generateCandidates(contexts);
  const mergedCandidates = mergeCandidates(candidates);
  const rankedCandidates = rankCandidates(mergedCandidates);

  return {
    bestOption: rankedCandidates[0] ?? null,
    candidates: rankedCandidates,
  };
}
