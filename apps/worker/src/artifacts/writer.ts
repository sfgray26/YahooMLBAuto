/**
 * Artifact Writer
 *
 * Writes structured JSON artifacts to disk for human review and audit.
 * Used by the DB-backed manual validation run to capture layer-by-layer
 * pipeline outputs (samples, stats, reason codes, etc.).
 *
 * Configuration (env vars):
 *   ARTIFACTS_ENABLED  - 'true' | 'false'  (default: 'false')
 *   ARTIFACT_DIR       - base directory     (default: 'artifacts')
 *   MAX_ARTIFACT_ROWS  - max rows per file  (default: 500)
 */

import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// Config
// ============================================================================

export interface ArtifactConfig {
  enabled: boolean;
  artifactDir: string;
  maxRows: number;
  runId: string;
}

export function resolveArtifactConfig(overrides: Partial<ArtifactConfig> = {}): ArtifactConfig {
  const enabled = overrides.enabled ?? (process.env.ARTIFACTS_ENABLED === 'true');
  const artifactDir = overrides.artifactDir ?? (process.env.ARTIFACT_DIR ?? 'artifacts');
  const maxRows = overrides.maxRows ?? parseInt(process.env.MAX_ARTIFACT_ROWS ?? '500', 10);
  const runId =
    overrides.runId ??
    (() => {
      const now = new Date();
      const pad = (n: number, len = 2) => String(n).padStart(len, '0');
      const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
      const time = `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
      return `run-${date}_${time}`;
    })();

  return { enabled, artifactDir, maxRows, runId };
}

// ============================================================================
// Types
// ============================================================================

export interface RunMetadataArtifact {
  runId: string;
  runTimestamp: string;
  gitSha: string | null;
  nodeEnv: string;
  maxRows: number;
  artifactDir: string;
  layers: string[];
}

export interface LayerSummary {
  layer: string;
  totalRecords: number;
  sampledRecords: number;
  errorCount: number;
  warningCount: number;
  stats: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

export interface ValidationReportArtifact {
  runId: string;
  runTimestamp: string;
  overallPass: boolean;
  totalErrors: number;
  totalWarnings: number;
  layers: LayerSummary[];
}

// ============================================================================
// Writer
// ============================================================================

export class ArtifactWriter {
  private readonly config: ArtifactConfig;
  private readonly runDir: string;
  private readonly layers: LayerSummary[] = [];

  constructor(config: ArtifactConfig) {
    this.config = config;
    this.runDir = path.join(config.artifactDir, config.runId);
  }

  /**
   * Create the run directory. Must be called before writing any artifacts.
   * No-op when artifacts are disabled.
   */
  init(): void {
    if (!this.config.enabled) return;
    fs.mkdirSync(this.runDir, { recursive: true });
  }

  /**
   * Write the run-metadata.json file.
   */
  writeRunMetadata(layers: string[]): void {
    if (!this.config.enabled) return;
    const meta: RunMetadataArtifact = {
      runId: this.config.runId,
      runTimestamp: new Date().toISOString(),
      gitSha: process.env.GIT_SHA ?? null,
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
      maxRows: this.config.maxRows,
      artifactDir: this.config.artifactDir,
      layers,
    };
    this.writeJson('run-metadata.json', meta);
  }

  /**
   * Write per-layer sampled records + summary stats.
   *
   * @param layer   - e.g. 'ingestion', 'derived', 'scoring', 'monte-carlo'
   * @param records - raw records array (will be sampled to maxRows)
   * @param summary - summary stats / metadata for the layer
   */
  writeLayerArtifact<T>(
    layer: string,
    records: T[],
    summary: Omit<LayerSummary, 'layer' | 'totalRecords' | 'sampledRecords'>
  ): void {
    if (!this.config.enabled) return;

    const sampled = records.slice(0, this.config.maxRows);
    const layerSummary: LayerSummary = {
      layer,
      totalRecords: records.length,
      sampledRecords: sampled.length,
      ...summary,
    };

    this.layers.push(layerSummary);
    this.writeJson(`${layer}-records.json`, sampled);
    this.writeJson(`${layer}-summary.json`, layerSummary);
  }

  /**
   * Write validation-report.json summarising all layers.
   */
  writeValidationReport(): ValidationReportArtifact {
    const totalErrors = this.layers.reduce((n, l) => n + l.errorCount, 0);
    const totalWarnings = this.layers.reduce((n, l) => n + l.warningCount, 0);
    const report: ValidationReportArtifact = {
      runId: this.config.runId,
      runTimestamp: new Date().toISOString(),
      overallPass: totalErrors === 0,
      totalErrors,
      totalWarnings,
      layers: this.layers,
    };
    if (this.config.enabled) {
      this.writeJson('validation-report.json', report);
    }
    return report;
  }

  /** Path to the run directory for this artifact set. */
  get directory(): string {
    return this.runDir;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private writeJson(filename: string, data: unknown): void {
    const filepath = path.join(this.runDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute basic numeric summary stats for an array of values.
 */
export function numericStats(values: number[]): {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
} {
  if (values.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p50: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / count;
  const p50 = sorted[Math.floor(count / 2)];
  return { count, min, max, mean: +mean.toFixed(4), p50 };
}
