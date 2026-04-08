/**
 * DB-Backed Manual Validation Run
 *
 * Connects to a real database (read-only replica recommended) and runs
 * pipeline layer validations, emitting structured artifacts for human review.
 *
 * Usage:
 *   DATABASE_URL=<url> ARTIFACTS_ENABLED=true pnpm validate:manual:db
 *
 * Environment variables:
 *   DATABASE_URL       - Postgres connection string (required)
 *   ARTIFACTS_ENABLED  - 'true' to write artifacts to disk (default: true for this script)
 *   ARTIFACT_DIR       - base directory for artifacts (default: artifacts)
 *   MAX_ARTIFACT_ROWS  - max rows per layer file (default: 500)
 *   VALIDATION_SEASON  - MLB season year (default: current year)
 *   VALIDATION_SAMPLE  - number of players to sample per layer (default: 50)
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { scorePlayer } from '../apps/worker/src/scoring/compute';
import { simulatePlayerOutcome } from '../apps/worker/src/monte-carlo/simulate';
import {
  ArtifactWriter,
  numericStats,
  resolveArtifactConfig,
} from '../apps/worker/src/artifacts/writer';
import {
  validateIngestionResult,
  validateDerivedStatsResult,
  validateDerivedRates,
  validatePipelineRun,
  type IngestionRunStats,
  type DerivedRunStats,
  type DerivedRateSample,
} from '../apps/worker/src/validation/pipeline';
import type { DerivedFeatures } from '../apps/worker/src/derived/index';

// ============================================================================
// Config
// ============================================================================

const SEASON = parseInt(process.env.VALIDATION_SEASON ?? String(new Date().getFullYear()), 10);
const SAMPLE_SIZE = parseInt(process.env.VALIDATION_SAMPLE ?? '50', 10);

// Default to enabled for this script (caller can override via env)
if (!process.env.ARTIFACTS_ENABLED) {
  process.env.ARTIFACTS_ENABLED = 'true';
}

const artifactConfig = resolveArtifactConfig();
const writer = new ArtifactWriter(artifactConfig);

// ============================================================================
// Helpers
// ============================================================================

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

function header(title: string): void {
  log('\n' + '='.repeat(70));
  log(title);
  log('='.repeat(70));
}

function safe<T>(val: T | null | undefined): T | null {
  return val ?? null;
}

// ============================================================================
// Layer 1: Ingestion
// ============================================================================

async function validateIngestion() {
  header('LAYER 1: INGESTION');

  const [playerCount, gameLogCount] = await Promise.all([
    prisma.playerDailyStats.count({ where: { season: SEASON } }),
    prisma.playerGameLog.count({ where: { season: SEASON } }),
  ]);

  const ingestionStats: IngestionRunStats = {
    totalPlayers: playerCount,
    totalGames: gameLogCount,
    errors: [],
  };

  const result = validateIngestionResult(ingestionStats);

  log(`Players (season ${SEASON}):   ${playerCount}`);
  log(`Game logs (season ${SEASON}): ${gameLogCount}`);
  log(`Validation: ${result.valid ? '✅ PASS' : '❌ FAIL'}`);
  result.errors.forEach((e) => log(`  ERROR: ${e}`));
  result.warnings.forEach((w) => log(`  WARN:  ${w}`));

  // Sample game logs
  const sampleGameLogs = await prisma.playerGameLog.findMany({
    where: { season: SEASON },
    take: SAMPLE_SIZE,
    orderBy: { gameDate: 'desc' },
  });

  writer.writeLayerArtifact(
    'ingestion',
    sampleGameLogs.map((g) => ({
      playerMlbamId: g.playerMlbamId,
      gamePk: g.gamePk,
      gameDate: g.gameDate,
      season: g.season,
      plateAppearances: g.plateAppearances,
      atBats: g.atBats,
      hits: g.hits,
      homeRuns: g.homeRuns,
      rbi: g.rbi,
      walks: g.walks,
      strikeouts: g.strikeouts,
    })),
    {
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      stats: {
        totalPlayers: playerCount,
        totalGameLogs: gameLogCount,
      },
      errors: result.errors,
      warnings: result.warnings,
    }
  );

  return { ingestionStats, result };
}

// ============================================================================
// Layer 2: Derived Stats
// ============================================================================

async function validateDerived() {
  header('LAYER 2: DERIVED STATS');

  const [derivedCount, derivedErrors] = await Promise.all([
    prisma.playerDerivedStats.count({ where: { season: SEASON } }),
    prisma.playerDerivedStats.count({
      where: { season: SEASON, battingAverageLast30: null },
    }),
  ]);

  const derivedRunStats: DerivedRunStats = {
    processed: derivedCount,
    errors: derivedErrors > 0 ? [`${derivedErrors} players missing battingAverageLast30`] : [],
  };

  const derivedResult = validateDerivedStatsResult(derivedRunStats);
  log(`Derived records: ${derivedCount}`);
  log(`Missing rates:   ${derivedErrors}`);
  log(`Validation: ${derivedResult.valid ? '✅ PASS' : '❌ FAIL'}`);
  derivedResult.errors.forEach((e) => log(`  ERROR: ${e}`));
  derivedResult.warnings.forEach((w) => log(`  WARN:  ${w}`));

  // Sample derived records
  const sampleDerived = await prisma.playerDerivedStats.findMany({
    where: { season: SEASON },
    orderBy: { computedAt: 'desc' },
    take: SAMPLE_SIZE,
  });

  const rateSamples: DerivedRateSample[] = sampleDerived.map((d) => ({
    playerMlbamId: d.playerMlbamId,
    battingAverageLast30: safe(d.battingAverageLast30) ?? 0,
    onBasePctLast30: safe(d.onBasePctLast30) ?? 0,
    sluggingPctLast30: safe(d.sluggingPctLast30) ?? 0,
    opsLast30: safe(d.opsLast30) ?? 0,
    isoLast30: safe(d.isoLast30) ?? 0,
    walkRateLast30: safe(d.walkRateLast30) ?? 0,
    strikeoutRateLast30: safe(d.strikeoutRateLast30) ?? 0,
    gamesLast7: safe(d.gamesLast7) ?? 0,
    gamesLast14: safe(d.gamesLast14) ?? 0,
    gamesLast30: safe(d.gamesLast30) ?? 0,
    plateAppearancesLast7: safe(d.plateAppearancesLast7) ?? 0,
    plateAppearancesLast14: safe(d.plateAppearancesLast14) ?? 0,
    plateAppearancesLast30: safe(d.plateAppearancesLast30) ?? 0,
  }));

  const rateResult = validateDerivedRates(rateSamples);
  log(`Rate validation: ${rateResult.valid ? '✅ PASS' : '❌ FAIL'}`);
  rateResult.errors.forEach((e) => log(`  ERROR: ${e}`));
  rateResult.warnings.forEach((w) => log(`  WARN:  ${w}`));

  // Compute summary stats
  const avgValues = sampleDerived
    .map((d) => d.battingAverageLast30)
    .filter((v): v is number => v !== null);
  const opsValues = sampleDerived
    .map((d) => d.opsLast30)
    .filter((v): v is number => v !== null);

  writer.writeLayerArtifact(
    'derived',
    sampleDerived.map((d) => ({
      playerMlbamId: d.playerMlbamId,
      season: d.season,
      computedAt: d.computedAt,
      gamesLast30: d.gamesLast30,
      battingAverageLast30: d.battingAverageLast30,
      onBasePctLast30: d.onBasePctLast30,
      sluggingPctLast30: d.sluggingPctLast30,
      opsLast30: d.opsLast30,
      isoLast30: d.isoLast30,
      walkRateLast30: d.walkRateLast30,
      strikeoutRateLast30: d.strikeoutRateLast30,
    })),
    {
      errorCount: derivedResult.errors.length + rateResult.errors.length,
      warningCount: derivedResult.warnings.length + rateResult.warnings.length,
      stats: {
        totalDerived: derivedCount,
        missingRates: derivedErrors,
        avgStats: JSON.stringify(numericStats(avgValues)),
        opsStats: JSON.stringify(numericStats(opsValues)),
      },
      errors: [...derivedResult.errors, ...rateResult.errors],
      warnings: [...derivedResult.warnings, ...rateResult.warnings],
    }
  );

  return { derivedResult, rateResult, derivedRunStats };
}

// ============================================================================
// Layer 3: Scoring
// ============================================================================

async function validateScoring() {
  header('LAYER 3: SCORING');

  const sampleDerived = await prisma.playerDerivedStats.findMany({
    where: {
      season: SEASON,
      gamesLast30: { gte: 5 },
    },
    orderBy: { computedAt: 'desc' },
    take: SAMPLE_SIZE,
  });

  log(`Scoring ${sampleDerived.length} sampled players...`);

  const errors: string[] = [];
  const warnings: string[] = [];
  const scored = [];

  for (const d of sampleDerived) {
    try {
      // Build DerivedFeatures from DB record
      const features: DerivedFeatures = {
        playerId: d.playerId,
        playerMlbamId: d.playerMlbamId,
        season: d.season,
        computedAt: d.computedAt,
        volume: {
          gamesLast7: d.gamesLast7 ?? 0,
          gamesLast14: d.gamesLast14 ?? 0,
          gamesLast30: d.gamesLast30 ?? 0,
          plateAppearancesLast7: d.plateAppearancesLast7 ?? 0,
          plateAppearancesLast14: d.plateAppearancesLast14 ?? 0,
          plateAppearancesLast30: d.plateAppearancesLast30 ?? 0,
          atBatsLast30: d.atBatsLast30 ?? 0,
        },
        rates: {
          battingAverageLast30: d.battingAverageLast30 ?? undefined,
          onBasePctLast30: d.onBasePctLast30 ?? undefined,
          sluggingPctLast30: d.sluggingPctLast30 ?? undefined,
          opsLast30: d.opsLast30 ?? undefined,
          isoLast30: d.isoLast30 ?? undefined,
          walkRateLast30: d.walkRateLast30 ?? undefined,
          strikeoutRateLast30: d.strikeoutRateLast30 ?? undefined,
          babipLast30: d.babipLast30 ?? undefined,
        },
        stabilization: {
          battingAverageReliable: (d.gamesLast30 ?? 0) >= 15,
          obpReliable: (d.gamesLast30 ?? 0) >= 15,
          slgReliable: (d.gamesLast30 ?? 0) >= 20,
          opsReliable: (d.gamesLast30 ?? 0) >= 20,
          gamesToReliable: Math.max(0, 20 - (d.gamesLast30 ?? 0)),
        },
        volatility: {
          hitConsistencyScore: d.hitConsistencyScore ?? 50,
          productionVolatility: d.productionVolatility ?? 1.0,
          zeroHitGamesLast14: d.zeroHitGamesLast14 ?? 0,
          multiHitGamesLast14: d.multiHitGamesLast14 ?? 0,
        },
        opportunity: {
          gamesStartedLast14: d.gamesLast14 ?? 0,
          lineupSpot: d.lineupSpot ?? 5,
          platoonRisk: (d.platoonRisk ?? 'low') as 'low' | 'medium' | 'high',
          playingTimeTrend: (d.playingTimeTrend ?? 'stable') as 'up' | 'stable' | 'down' | null,
        },
        replacement: {
          positionEligibility: d.positionEligibility.length > 0 ? d.positionEligibility : ['UTIL'],
          waiverWireValue: null,
          rosteredPercent: 0,
        },
      };

      const score = scorePlayer(features);

      // Sanity check
      if (score.overallValue < 0 || score.overallValue > 100) {
        errors.push(
          `Player ${d.playerMlbamId}: overallValue=${score.overallValue} out of [0,100]`
        );
      }
      if (score.confidence < 0 || score.confidence > 1) {
        warnings.push(
          `Player ${d.playerMlbamId}: confidence=${score.confidence} out of [0,1]`
        );
      }

      scored.push({
        playerMlbamId: d.playerMlbamId,
        overallValue: score.overallValue,
        confidence: score.confidence,
        hitting: score.components.hitting,
        power: score.components.power,
        speed: score.components.speed,
        plateDiscipline: score.components.plateDiscipline,
        consistency: score.components.consistency,
        opportunity: score.components.opportunity,
        sampleSize: score.reliability.sampleSize,
        summary: score.explanation.summary,
        strengths: score.explanation.strengths.slice(0, 3),
        concerns: score.explanation.concerns.slice(0, 3),
      });
    } catch (err) {
      errors.push(`Player ${d.playerMlbamId}: scoring error - ${String(err)}`);
    }
  }

  log(`Scored: ${scored.length} / ${sampleDerived.length}`);
  log(`Errors: ${errors.length}`);
  log(`Validation: ${errors.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
  errors.forEach((e) => log(`  ERROR: ${e}`));
  warnings.forEach((w) => log(`  WARN:  ${w}`));

  const overallValues = scored.map((s) => s.overallValue);
  const confidenceValues = scored.map((s) => s.confidence);

  writer.writeLayerArtifact('scoring', scored, {
    errorCount: errors.length,
    warningCount: warnings.length,
    stats: {
      scoredPlayers: scored.length,
      overallValueStats: JSON.stringify(numericStats(overallValues)),
      confidenceStats: JSON.stringify(numericStats(confidenceValues)),
    },
    errors,
    warnings,
  });

  return { scored, errors, warnings };
}

// ============================================================================
// Layer 4: Monte Carlo
// ============================================================================

async function validateMonteCarlo(
  scoredPlayers: Array<{
    playerMlbamId: string;
    overallValue: number;
    confidence: number;
  }>
) {
  header('LAYER 4: MONTE CARLO SIMULATION');

  if (scoredPlayers.length === 0) {
    log('⚠️  No scored players to simulate');
    writer.writeLayerArtifact('monte-carlo', [], {
      errorCount: 0,
      warningCount: 1,
      stats: {},
      errors: [],
      warnings: ['No scored players available for Monte Carlo'],
    });
    return;
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const simResults = [];
  const sampleForSim = scoredPlayers.slice(0, Math.min(SAMPLE_SIZE, scoredPlayers.length));

  log(`Simulating ${sampleForSim.length} players...`);

  // Get derived stats for simulation inputs
  const derivedMap = await prisma.playerDerivedStats.findMany({
    where: {
      playerMlbamId: { in: sampleForSim.map((s) => s.playerMlbamId) },
      season: SEASON,
    },
    distinct: ['playerMlbamId'],
  });

  const derivedByMlbam = new Map(derivedMap.map((d) => [d.playerMlbamId, d]));

  for (const sp of sampleForSim) {
    const d = derivedByMlbam.get(sp.playerMlbamId);
    if (!d) continue;

    try {
      const mcInput = {
        playerId: d.playerId,
        playerMlbamId: d.playerMlbamId,
        volume: {
          plateAppearancesLast7: d.plateAppearancesLast7 ?? 0,
          plateAppearancesLast14: d.plateAppearancesLast14 ?? 0,
          plateAppearancesLast30: d.plateAppearancesLast30 ?? 0,
          gamesLast7: d.gamesLast7 ?? 0,
          gamesLast14: d.gamesLast14 ?? 0,
          gamesLast30: d.gamesLast30 ?? 0,
        },
        rates: {
          opsLast30: d.opsLast30 ?? undefined,
          onBasePctLast30: d.onBasePctLast30 ?? undefined,
          isoLast30: d.isoLast30 ?? undefined,
          battingAverageLast30: d.battingAverageLast30 ?? undefined,
          walkRateLast30: d.walkRateLast30 ?? undefined,
          strikeoutRateLast30: d.strikeoutRateLast30 ?? undefined,
        },
        volatility: {
          productionVolatility: d.productionVolatility ?? 1.0,
          hitConsistencyScore: d.hitConsistencyScore ?? 50,
        },
      };

      const playerScore = {
        playerId: d.playerId,
        playerMlbamId: d.playerMlbamId,
        season: d.season,
        scoredAt: new Date(),
        overallValue: sp.overallValue,
        components: {
          hitting: sp.overallValue * 0.3,
          power: sp.overallValue * 0.2,
          speed: sp.overallValue * 0.1,
          plateDiscipline: sp.overallValue * 0.2,
          consistency: sp.overallValue * 0.1,
          opportunity: sp.overallValue * 0.1,
        },
        confidence: sp.confidence,
        reliability: {
          sampleSize: 'adequate' as const,
          gamesToReliable: 0,
          statsReliable: true,
        },
        explanation: {
          summary: '',
          strengths: [],
          concerns: [],
          keyStats: {},
        },
        inputs: {
          derivedFeaturesVersion: 'v1',
          computedAt: new Date(),
        },
      };

      const sim = simulatePlayerOutcome(mcInput, playerScore, {
        runs: 500,
        horizon: 'daily',
        randomSeed: 42,
        dataVersion: `season-${SEASON}`,
      });

      // Sanity checks
      if (sim.expectedValue < 0) {
        warnings.push(`Player ${d.playerMlbamId}: negative expectedValue ${sim.expectedValue}`);
      }
      if (sim.p90 < sim.p10) {
        errors.push(
          `Player ${d.playerMlbamId}: p90(${sim.p90}) < p10(${sim.p10}) - invalid distribution`
        );
      }

      simResults.push({
        playerMlbamId: d.playerMlbamId,
        horizon: sim.horizon,
        runs: sim.runs,
        expectedValue: sim.expectedValue,
        median: sim.median,
        p10: sim.p10,
        p25: sim.p25,
        p75: sim.p75,
        p90: sim.p90,
        variance: sim.variance,
        standardDeviation: sim.standardDeviation,
        downsideRisk: sim.downsideRisk,
        upsidePotential: sim.upsidePotential,
        riskAdjustedValue: sim.riskAdjustedValue,
        confidenceImpact: sim.confidenceImpact,
        runMetadata: sim.runMetadata,
      });
    } catch (err) {
      errors.push(`Player ${sp.playerMlbamId}: Monte Carlo error - ${String(err)}`);
    }
  }

  log(`Simulated: ${simResults.length} players`);
  log(`Errors: ${errors.length}`);
  log(`Validation: ${errors.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
  errors.forEach((e) => log(`  ERROR: ${e}`));
  warnings.forEach((w) => log(`  WARN:  ${w}`));

  const evValues = simResults.map((s) => s.expectedValue);
  const p90Values = simResults.map((s) => s.p90);

  writer.writeLayerArtifact('monte-carlo', simResults, {
    errorCount: errors.length,
    warningCount: warnings.length,
    stats: {
      simulatedPlayers: simResults.length,
      evStats: JSON.stringify(numericStats(evValues)),
      p90Stats: JSON.stringify(numericStats(p90Values)),
      seed: 42,
      runs: 500,
    },
    errors,
    warnings,
  });

  return { simResults, errors, warnings };
}

// ============================================================================
// Layer 5: Lineup / Recommendations
// ============================================================================

async function validateRecommendations(
  scoredPlayers: Array<{
    playerMlbamId: string;
    overallValue: number;
    confidence: number;
    summary: string;
    strengths: string[];
    concerns: string[];
  }>
) {
  header('LAYER 5: LINEUP / RECOMMENDATIONS');

  if (scoredPlayers.length === 0) {
    log('⚠️  No scored players for recommendations');
    writer.writeLayerArtifact('recommendations', [], {
      errorCount: 0,
      warningCount: 1,
      stats: {},
      errors: [],
      warnings: ['No scored players available'],
    });
    return;
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Sort by overall value descending → top picks
  const ranked = [...scoredPlayers].sort((a, b) => b.overallValue - a.overallValue);
  const top = ranked.slice(0, Math.min(SAMPLE_SIZE, ranked.length));

  // Basic sanity: top player should have overallValue >= threshold
  const topScore = top[0]?.overallValue ?? 0;
  if (topScore < 20) {
    warnings.push(`Top scored player has overallValue=${topScore} – unexpectedly low`);
  }

  // Check for duplicates
  const seen = new Set<string>();
  for (const p of ranked) {
    if (seen.has(p.playerMlbamId)) {
      errors.push(`Duplicate playerMlbamId in scored list: ${p.playerMlbamId}`);
    }
    seen.add(p.playerMlbamId);
  }

  log(`Total scored players: ${scoredPlayers.length}`);
  log(`Top player value:     ${topScore.toFixed(1)}`);
  log(`Errors: ${errors.length}`);
  log(`Validation: ${errors.length === 0 ? '✅ PASS' : '❌ FAIL'}`);

  const recommendations = top.map((p, rank) => ({
    rank: rank + 1,
    playerMlbamId: p.playerMlbamId,
    overallValue: p.overallValue,
    confidence: p.confidence,
    summary: p.summary,
    strengths: p.strengths,
    concerns: p.concerns,
    reasonCodes: [
      ...(p.overallValue >= 75 ? ['ELITE_OVERALL'] : []),
      ...(p.overallValue >= 50 && p.overallValue < 75 ? ['ABOVE_AVERAGE'] : []),
      ...(p.confidence >= 0.7 ? ['HIGH_CONFIDENCE'] : []),
      ...(p.confidence < 0.4 ? ['LOW_CONFIDENCE'] : []),
    ],
  }));

  writer.writeLayerArtifact('recommendations', recommendations, {
    errorCount: errors.length,
    warningCount: warnings.length,
    stats: {
      totalCandidates: scoredPlayers.length,
      topScore,
      recommendationsProduced: recommendations.length,
    },
    errors,
    warnings,
  });

  return { recommendations, errors, warnings };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  log('\n' + '='.repeat(70));
  log('DB-BACKED MANUAL VALIDATION RUN');
  log(`Season: ${SEASON}  |  Sample: ${SAMPLE_SIZE} players per layer`);
  log(`Artifacts: ${artifactConfig.enabled ? '✅ enabled → ' + artifactConfig.artifactDir : '❌ disabled'}`);
  log('='.repeat(70));

  if (!process.env.DATABASE_URL) {
    console.error('\n❌ DATABASE_URL is not set. Exiting.');
    process.exit(1);
  }

  const layers = ['ingestion', 'derived', 'scoring', 'monte-carlo', 'recommendations'];
  writer.init();
  writer.writeRunMetadata(layers);

  // Run layers
  const { ingestionStats } = await validateIngestion();
  const { derivedRunStats, derivedResult, rateResult } = await validateDerived();
  const { scored, errors: scoringErrors } = await validateScoring();
  await validateMonteCarlo(scored);
  await validateRecommendations(scored);

  // Full pipeline validation
  header('PIPELINE VALIDATION SUMMARY');
  const pipelineRun = validatePipelineRun({
    hitterIngestion: ingestionStats,
    pitcherIngestion: { totalPlayers: 0, totalGames: 0, errors: [] },
    hitterDerived: derivedRunStats,
    pitcherDerived: { processed: 0, errors: [] },
  });

  pipelineRun.stages.forEach((s) => {
    log(`  ${s.stage}: ${s.valid ? '✅' : '❌'}  errors=${s.errors.length} warnings=${s.warnings.length}`);
  });

  // Write final validation report
  const report = writer.writeValidationReport();

  log('\n' + '='.repeat(70));
  log('FINAL RESULT');
  log('='.repeat(70));
  log(`Overall pass:    ${report.overallPass ? '✅ PASS' : '❌ FAIL'}`);
  log(`Total errors:    ${report.totalErrors}`);
  log(`Total warnings:  ${report.totalWarnings}`);

  if (artifactConfig.enabled) {
    log(`\nArtifacts written to: ${writer.directory}`);
    log('  run-metadata.json');
    log('  validation-report.json');
    layers.forEach((l) => {
      log(`  ${l}-records.json`);
      log(`  ${l}-summary.json`);
    });
  }

  await prisma.$disconnect();

  process.exit(report.totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n❌ Validation run failed:', err);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
