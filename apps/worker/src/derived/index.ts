/**
 * Derived Features Module
 *
 * Deterministic, reproducible feature computation.
 * No opinions, no strategy — just objectively true features.
 */

export { computeDerivedFeatures } from './compute.js';
export { storeDerivedFeatures, getDerivedFeatures, getAllDerivedFeatures } from './storage.js';
export { computeAllDerivedFeatures, computePlayerDerivedFeatures } from './orchestrator.js';
export type { DerivedFeatures } from './compute.js';
