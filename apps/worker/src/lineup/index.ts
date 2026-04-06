/**
 * Lineup Optimization Module
 *
 * Constrained, context-aware, probabilistic lineup optimization.
 *
 * Exports:
 * - optimizeLineup: Main optimization function
 * - Types for integration with other modules
 */

export {
  optimizeLineup,
  calculateObjective,
  type OptimizedLineup,
  type LineupAssignment,
  type LineupExplanation,
  type DecisionStep,
  type OptimizerConfig,
  type PlayerWithIntelligence,
} from './optimizer.js';
