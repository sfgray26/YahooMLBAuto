/**
 * Artifact Writer Tests
 *
 * Pure unit tests – no DB, no network, no file system writes.
 * File-system write tests use a temp directory and clean up after themselves.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArtifactWriter,
  numericStats,
  resolveArtifactConfig,
  type ArtifactConfig,
} from './writer.js';

// ============================================================================
// resolveArtifactConfig
// ============================================================================

describe('resolveArtifactConfig', () => {
  it('defaults to disabled when env var is absent', () => {
    const cfg = resolveArtifactConfig({ runId: 'test-run' });
    expect(cfg.enabled).toBe(false);
  });

  it('enables when env var is "true"', () => {
    process.env.ARTIFACTS_ENABLED = 'true';
    const cfg = resolveArtifactConfig({ runId: 'test-run' });
    expect(cfg.enabled).toBe(true);
    delete process.env.ARTIFACTS_ENABLED;
  });

  it('respects override for maxRows', () => {
    const cfg = resolveArtifactConfig({ maxRows: 42, runId: 'r' });
    expect(cfg.maxRows).toBe(42);
  });

  it('uses MAX_ARTIFACT_ROWS env var', () => {
    process.env.MAX_ARTIFACT_ROWS = '999';
    const cfg = resolveArtifactConfig({ runId: 'r' });
    expect(cfg.maxRows).toBe(999);
    delete process.env.MAX_ARTIFACT_ROWS;
  });

  it('generates a runId containing a timestamp if not provided', () => {
    const cfg = resolveArtifactConfig({ enabled: false });
    expect(cfg.runId).toMatch(/^run-/);
  });
});

// ============================================================================
// numericStats
// ============================================================================

describe('numericStats', () => {
  it('returns nulls for empty array', () => {
    const s = numericStats([]);
    expect(s.count).toBe(0);
    expect(s.min).toBeNull();
    expect(s.max).toBeNull();
    expect(s.mean).toBeNull();
    expect(s.p50).toBeNull();
  });

  it('handles single value', () => {
    const s = numericStats([7]);
    expect(s.count).toBe(1);
    expect(s.min).toBe(7);
    expect(s.max).toBe(7);
    expect(s.mean).toBe(7);
    expect(s.p50).toBe(7);
  });

  it('computes correct stats for known values', () => {
    // [1, 2, 3, 4, 5] → mean=3, min=1, max=5, p50=3
    const s = numericStats([5, 1, 3, 2, 4]);
    expect(s.count).toBe(5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.mean).toBe(3);
    expect(s.p50).toBe(3);
  });

  it('rounds mean to 4 decimal places', () => {
    // 1/3 ≈ 0.3333
    const s = numericStats([0, 0, 1]);
    expect(s.mean).toBe(0.3333);
  });
});

// ============================================================================
// ArtifactWriter – disabled mode
// ============================================================================

describe('ArtifactWriter (disabled)', () => {
  const cfg: ArtifactConfig = {
    enabled: false,
    artifactDir: '/should/not/be/created',
    maxRows: 10,
    runId: 'test-run',
  };

  it('does not create any directories when disabled', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();
    expect(fs.existsSync('/should/not/be/created')).toBe(false);
  });

  it('writeRunMetadata is a no-op when disabled', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();
    expect(() => writer.writeRunMetadata(['ingestion'])).not.toThrow();
  });

  it('writeLayerArtifact is a no-op when disabled', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();
    expect(() =>
      writer.writeLayerArtifact('ingestion', [], {
        errorCount: 0,
        warningCount: 0,
        stats: {},
        errors: [],
        warnings: [],
      })
    ).not.toThrow();
  });

  it('writeValidationReport returns a report object even when disabled', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();
    const report = writer.writeValidationReport();
    expect(report.overallPass).toBe(true);
    expect(report.totalErrors).toBe(0);
    expect(report.runId).toBe('test-run');
  });
});

// ============================================================================
// ArtifactWriter – enabled mode (uses real temp dir)
// ============================================================================

describe('ArtifactWriter (enabled)', () => {
  let tmpDir: string;
  let cfg: ArtifactConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-writer-test-'));
    cfg = {
      enabled: true,
      artifactDir: tmpDir,
      maxRows: 3,
      runId: 'test-run-enabled',
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the run directory on init', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();
    expect(fs.existsSync(path.join(tmpDir, 'test-run-enabled'))).toBe(true);
  });

  it('writes run-metadata.json', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();
    writer.writeRunMetadata(['ingestion', 'scoring']);

    const meta = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'test-run-enabled', 'run-metadata.json'), 'utf8')
    );
    expect(meta.runId).toBe('test-run-enabled');
    expect(meta.layers).toEqual(['ingestion', 'scoring']);
    expect(meta.maxRows).toBe(3);
  });

  it('samples records to maxRows', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();

    const records = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    writer.writeLayerArtifact('ingestion', records, {
      errorCount: 0,
      warningCount: 0,
      stats: { count: 10 },
      errors: [],
      warnings: [],
    });

    const sampled = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'test-run-enabled', 'ingestion-records.json'), 'utf8')
    );
    expect(sampled).toHaveLength(3); // maxRows = 3
    expect(sampled[0]).toEqual({ id: 0 });
  });

  it('writes layer summary with correct totalRecords and sampledRecords', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();

    writer.writeLayerArtifact('scoring', [{ id: 1 }, { id: 2 }], {
      errorCount: 1,
      warningCount: 2,
      stats: { top: 'value' },
      errors: ['err1'],
      warnings: ['warn1', 'warn2'],
    });

    const summary = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'test-run-enabled', 'scoring-summary.json'), 'utf8')
    );
    expect(summary.layer).toBe('scoring');
    expect(summary.totalRecords).toBe(2);
    expect(summary.sampledRecords).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(2);
  });

  it('writeValidationReport aggregates errors/warnings from all layers', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();

    writer.writeLayerArtifact('ingestion', [], {
      errorCount: 2,
      warningCount: 1,
      stats: {},
      errors: ['e1', 'e2'],
      warnings: ['w1'],
    });
    writer.writeLayerArtifact('scoring', [], {
      errorCount: 0,
      warningCount: 3,
      stats: {},
      errors: [],
      warnings: ['w2', 'w3', 'w4'],
    });

    const report = writer.writeValidationReport();
    expect(report.totalErrors).toBe(2);
    expect(report.totalWarnings).toBe(4);
    expect(report.overallPass).toBe(false);
    expect(report.layers).toHaveLength(2);

    const written = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, 'test-run-enabled', 'validation-report.json'),
        'utf8'
      )
    );
    expect(written.totalErrors).toBe(2);
  });

  it('reports overallPass=true when no errors', () => {
    const writer = new ArtifactWriter(cfg);
    writer.init();
    writer.writeLayerArtifact('scoring', [], {
      errorCount: 0,
      warningCount: 0,
      stats: {},
      errors: [],
      warnings: [],
    });
    const report = writer.writeValidationReport();
    expect(report.overallPass).toBe(true);
  });
});

// ============================================================================
// Validation report formatting
// ============================================================================

describe('validation report format', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-format-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('report contains required top-level fields', () => {
    const cfg: ArtifactConfig = {
      enabled: true,
      artifactDir: tmpDir,
      maxRows: 10,
      runId: 'format-test',
    };
    const writer = new ArtifactWriter(cfg);
    writer.init();
    const report = writer.writeValidationReport();

    expect(report).toHaveProperty('runId');
    expect(report).toHaveProperty('runTimestamp');
    expect(report).toHaveProperty('overallPass');
    expect(report).toHaveProperty('totalErrors');
    expect(report).toHaveProperty('totalWarnings');
    expect(report).toHaveProperty('layers');
    expect(Array.isArray(report.layers)).toBe(true);
  });

  it('layer summary contains required fields', () => {
    const cfg: ArtifactConfig = {
      enabled: true,
      artifactDir: tmpDir,
      maxRows: 10,
      runId: 'layer-fields-test',
    };
    const writer = new ArtifactWriter(cfg);
    writer.init();
    writer.writeLayerArtifact('test-layer', [{ x: 1 }], {
      errorCount: 0,
      warningCount: 0,
      stats: { mean: 1.5 },
      errors: [],
      warnings: [],
    });
    const report = writer.writeValidationReport();
    const layerSummary = report.layers[0];

    expect(layerSummary).toHaveProperty('layer', 'test-layer');
    expect(layerSummary).toHaveProperty('totalRecords');
    expect(layerSummary).toHaveProperty('sampledRecords');
    expect(layerSummary).toHaveProperty('errorCount');
    expect(layerSummary).toHaveProperty('warningCount');
    expect(layerSummary).toHaveProperty('stats');
    expect(layerSummary).toHaveProperty('errors');
    expect(layerSummary).toHaveProperty('warnings');
  });
});
