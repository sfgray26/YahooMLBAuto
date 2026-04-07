import type { ConfidenceLevel } from '@cbb/core';

export const CONFIDENCE_THRESHOLDS = {
  very_high: 0.9,
  high: 0.75,
  moderate: 0.6,
  low: 0.4,
} as const;

const CONFIDENCE_SCORE_MAP: Record<ConfidenceLevel, number> = {
  very_high: 1.0,
  high: 0.8,
  moderate: 0.6,
  low: 0.4,
  very_low: 0.2,
};

export function mapConfidenceLabel(confidence: number): ConfidenceLevel {
  if (confidence >= CONFIDENCE_THRESHOLDS.very_high) return 'very_high';
  if (confidence >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (confidence >= CONFIDENCE_THRESHOLDS.moderate) return 'moderate';
  if (confidence >= CONFIDENCE_THRESHOLDS.low) return 'low';
  return 'very_low';
}

export function confidenceLevelToScore(confidence: ConfidenceLevel): number {
  return CONFIDENCE_SCORE_MAP[confidence];
}
