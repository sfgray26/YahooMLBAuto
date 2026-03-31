/**
 * Player Scoring Module
 *
 * Deterministic transformation: derived features → value scores.
 * Stateless, explainable, cacheable.
 */

export { scorePlayer, scorePlayers } from './compute.js';
export { batchScorePlayers, scoreSinglePlayer } from './orchestrator.js';
export type { PlayerScore } from './compute.js';
