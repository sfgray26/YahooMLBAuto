/**
 * Decision Assembly Module
 *
 * Transforms PlayerScores into concrete decisions.
 * Deterministic, no probabilistic layers yet.
 */

export { assembleLineupDomainAware as assembleLineup, type DomainAwareAssemblyInput as AssemblyInput, type LineupOptimizationResult as AssemblyResult } from './lineupAssembly.js';
export { assembleWaiverDecisionsFromTeamState as assembleWaiverDecisions, type TeamStateWaiverInput as WaiverAssemblyInput, type WaiverAssemblyResult } from './waiverAssembly.js';
