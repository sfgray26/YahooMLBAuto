import { describe, expect, it } from 'vitest';

import { resolvePositionEligibility } from './orchestrator.js';

describe('resolvePositionEligibility', () => {
  it('keeps persisted eligibility when present', () => {
    expect(resolvePositionEligibility(['1b', ' dh '], ['OF'])).toEqual(['1B', 'DH']);
  });

  it('falls back to request eligibility when persisted eligibility is empty', () => {
    expect(resolvePositionEligibility([], ['of', 'cf'])).toEqual(['OF', 'CF']);
  });

  it('filters blank fallback values', () => {
    expect(resolvePositionEligibility([], [' ', 'ss'])).toEqual(['SS']);
  });
});
