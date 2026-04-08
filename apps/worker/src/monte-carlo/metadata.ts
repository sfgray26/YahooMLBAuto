/**
 * Monte Carlo Run Metadata
 *
 * Captures provenance information for every simulation run so that outputs
 * are fully reproducible and auditable.
 *
 * Fields are attached to PlayerOutcomeDistribution via simulationNotes and
 * can be embedded in any serialised output artifact.
 */

// ============================================================================
// Types
// ============================================================================

export interface RunMetadata {
  /** ISO-8601 UTC timestamp of when the run started. */
  runTimestamp: string;

  /** Deterministic seed used for the RNG in this run. */
  seed: number;

  /** Number of simulation trials executed. */
  trialCount: number;

  /** Simulation horizon ('daily' or 'weekly'). */
  horizon: 'daily' | 'weekly';

  /** Short git commit SHA (if available via GIT_SHA env var). */
  gitSha: string | null;

  /** Identifier of the derived-stats data snapshot used as input. */
  dataVersion: string | null;

  /** Optional arbitrary key/value pairs for additional context. */
  extra?: Record<string, string | number | boolean>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Build a RunMetadata object for a simulation run.
 *
 * @param seed - The resolved RNG seed for this run
 * @param trialCount - Number of trials (config.runs)
 * @param horizon - Simulation horizon
 * @param dataVersion - Optional version/hash of the input dataset
 * @param extra - Optional extra context fields
 */
export function buildRunMetadata(
  seed: number,
  trialCount: number,
  horizon: 'daily' | 'weekly',
  dataVersion?: string | null,
  extra?: Record<string, string | number | boolean>
): RunMetadata {
  return {
    runTimestamp: new Date().toISOString(),
    seed,
    trialCount,
    horizon,
    gitSha: process.env.GIT_SHA ?? null,
    dataVersion: dataVersion ?? null,
    ...(extra ? { extra } : {}),
  };
}

/**
 * Serialise RunMetadata into a human-readable string for inclusion in
 * simulationNotes arrays.
 */
export function formatRunMetadata(meta: RunMetadata): string {
  const sha = meta.gitSha ? ` git=${meta.gitSha}` : '';
  const data = meta.dataVersion ? ` data=${meta.dataVersion}` : '';
  return (
    `Run metadata: timestamp=${meta.runTimestamp} seed=${meta.seed}` +
    ` trials=${meta.trialCount} horizon=${meta.horizon}${sha}${data}`
  );
}
