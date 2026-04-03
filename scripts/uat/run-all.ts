/**
 * Phase 1 UAT Runner - Foundation Integrity Tests
 * 
 * Executes all data pipeline validation tests and generates a comprehensive report.
 * Exit codes:
 *   0 = All critical tests passed
 *   1 = Critical test failure
 *   2 = Warning(s) only
 */

import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@cbb/infrastructure';
import type { UATTestResult, UATReport } from './types.js';

// Import all validators
import {
  checkRawToNormalizedDrift,
  checkIngestionStability,
  checkPlayerCoverage,
} from './validators/row-count-drift.js';

import {
  checkDuplicateGameLogs,
  checkDuplicateDailyStats,
  checkDuplicateRawIngestion,
  checkDuplicateVerifiedPlayers,
  checkDuplicateDerivedStats,
} from './validators/duplicate-detection.js';

import {
  checkGameLogAggregation,
  checkDerivedStatsAccuracy,
  checkAnomalousStats,
} from './validators/stat-inflation.js';

import {
  checkDateGaps,
  checkMissingPlayers,
  checkDataFreshness,
  checkTeamScheduleCompleteness,
} from './validators/completeness.js';

import {
  checkRawToNormalizedReconciliation,
  checkGameLogTraceability,
  checkDerivedFeatureReconciliation,
  checkRawDataPreservation,
} from './validators/reconciliation.js';

interface RunOptions {
  season: number;
  verbose: boolean;
  json: boolean;
  category?: string;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const options: RunOptions = {
    season: new Date().getFullYear(),
    verbose: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--season' || arg === '-s') {
      options.season = parseInt(args[++i]);
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--json' || arg === '-j') {
      options.json = true;
    } else if (arg === '--category' || arg === '-c') {
      options.category = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Phase 1 UAT - Foundation Integrity Tests

Usage: npx tsx scripts/uat/run-all.ts [options]

Options:
  -s, --season <year>    MLB season to test (default: current year)
  -v, --verbose          Show detailed output
  -j, --json             Output JSON report only
  -c, --category <cat>   Run only specific category:
                         row_count, duplicates, stat_inflation, completeness, reconciliation
  -h, --help             Show this help

Examples:
  npx tsx scripts/uat/run-all.ts --season 2025 --verbose
  npx tsx scripts/uat/run-all.ts --category duplicates --json
`);
      process.exit(0);
    }
  }

  return options;
}

async function runAllTests(options: RunOptions): Promise<UATTestResult[]> {
  const { season, category } = options;
  const results: UATTestResult[] = [];

  const config = {
    season,
    acceptableVariancePercent: 5,
    sampleSize: 50,
    playerMlbamIds: [],
    statsToValidate: ['gamesPlayed', 'atBats', 'hits', 'homeRuns', 'rbi'] as const,
    tables: ['playerGameLog', 'playerDailyStats', 'rawIngestionLog'] as const,
    expectedPlayers: [],
    dateRange: {
      start: new Date(`${season}-03-01`),
      end: new Date(),
    },
  };

  const reconciliationConfig = {
    season,
    sampleSize: 50,
  };

  // Row Count Drift Tests
  if (!category || category === 'row_count') {
    if (!options.json) console.log('\n📊 Running Row Count Drift Tests...\n');
    results.push(
      await checkRawToNormalizedDrift(config),
      await checkIngestionStability(config),
      await checkPlayerCoverage(config)
    );
  }

  // Duplicate Detection Tests
  if (!category || category === 'duplicates') {
    if (!options.json) console.log('\n🔍 Running Duplicate Detection Tests...\n');
    results.push(
      await checkDuplicateGameLogs(config),
      await checkDuplicateDailyStats(config),
      await checkDuplicateRawIngestion(config),
      await checkDuplicateVerifiedPlayers(),
      await checkDuplicateDerivedStats(config)
    );
  }

  // Stat Inflation Tests
  if (!category || category === 'stat_inflation') {
    if (!options.json) console.log('\n📈 Running Stat Inflation Tests...\n');
    results.push(
      await checkGameLogAggregation(config),
      await checkDerivedStatsAccuracy(config),
      await checkAnomalousStats(season)
    );
  }

  // Completeness Tests
  if (!category || category === 'completeness') {
    if (!options.json) console.log('\n✅ Running Data Completeness Tests...\n');
    results.push(
      await checkDateGaps(config),
      await checkMissingPlayers(config),
      await checkDataFreshness(season),
      await checkTeamScheduleCompleteness(season)
    );
  }

  // Reconciliation Tests
  if (!category || category === 'reconciliation') {
    if (!options.json) console.log('\n🔗 Running Raw vs Normalized Reconciliation Tests...\n');
    results.push(
      await checkRawToNormalizedReconciliation(reconciliationConfig),
      await checkGameLogTraceability(season),
      await checkDerivedFeatureReconciliation(season),
      await checkRawDataPreservation(season)
    );
  }

  return results;
}

function generateReport(results: UATTestResult[], season: number): UATReport {
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const criticalIssues = results
    .filter(r => r.severity === 'critical' && r.status === 'fail')
    .map(r => r.message);

  return {
    runId: uuidv4(),
    timestamp: new Date(),
    season,
    summary: {
      total: results.length,
      passed,
      failed,
      warnings,
    },
    results,
    criticalIssues,
  };
}

function printConsoleReport(report: UATReport, verbose: boolean) {
  const { summary, results, criticalIssues } = report;

  console.log('\n' + '='.repeat(70));
  console.log('  PHASE 1 UAT REPORT - FOUNDATION INTEGRITY');
  console.log('  MLB Season:', report.season);
  console.log('  Run ID:', report.runId);
  console.log('  Timestamp:', report.timestamp.toISOString());
  console.log('='.repeat(70));

  // Summary
  console.log('\n📊 SUMMARY\n');
  console.log(`   Total Tests:  ${summary.total}`);
  console.log(`   ✅ Passed:     ${summary.passed}`);
  console.log(`   ❌ Failed:     ${summary.failed}`);
  console.log(`   ⚠️  Warnings:   ${summary.warnings}`);

  // Critical Issues
  if (criticalIssues.length > 0) {
    console.log('\n🚨 CRITICAL ISSUES (Block Release)\n');
    criticalIssues.forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue}`);
    });
  }

  // Results by Category
  const categories = ['row_count', 'duplicates', 'stat_inflation', 'completeness', 'reconciliation'] as const;
  const categoryNames = {
    row_count: 'Row Count Drift',
    duplicates: 'Duplicate Detection',
    stat_inflation: 'Stat Inflation',
    completeness: 'Data Completeness',
    reconciliation: 'Reconciliation',
  };

  console.log('\n📋 DETAILED RESULTS\n');
  
  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    if (categoryResults.length === 0) continue;

    const passedCount = categoryResults.filter(r => r.status === 'pass').length;
    const icon = passedCount === categoryResults.length ? '✅' : '⚠️';
    console.log(`\n${icon} ${categoryNames[category]} (${passedCount}/${categoryResults.length} passed)\n`);

    for (const result of categoryResults) {
      const statusIcon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      console.log(`   ${statusIcon} [${result.severity.toUpperCase()}] ${result.testName}`);
      console.log(`      ${result.message}`);
      
      if (verbose && result.details) {
        console.log(`      Details:`, JSON.stringify(result.details, null, 2).split('\n').join('\n      '));
      }
      console.log();
    }
  }

  // Exit Criteria Assessment
  console.log('\n' + '='.repeat(70));
  console.log('  EXIT CRITERIA ASSESSMENT');
  console.log('='.repeat(70));
  
  const canTrustSystem = summary.failed === 0 && criticalIssues.length === 0;
  
  if (canTrustSystem) {
    console.log('\n   ✅ SYSTEM TRUSTED');
    console.log('   The system accurately reflects what happened in MLB.');
    console.log('   You can proceed with confidence.\n');
  } else if (criticalIssues.length > 0) {
    console.log('\n   🚫 SYSTEM NOT TRUSTED - CRITICAL ISSUES DETECTED');
    console.log('   Do not use this data for fantasy decisions.');
    console.log('   Fix critical issues before proceeding.\n');
  } else {
    console.log('\n   ⚠️  SYSTEM PARTIALLY TRUSTED');
    console.log('   Non-critical issues detected.');
    console.log('   Review warnings before using for fantasy decisions.\n');
  }

  console.log('='.repeat(70));
}

async function main() {
  const options = parseArgs();
  
  if (!options.json) {
    console.log('\n🏗️  Phase 1 UAT - Foundation Integrity Tests');
    console.log(`   MLB Season: ${options.season}`);
    console.log(`   Started at: ${new Date().toISOString()}\n`);
  }

  try {
    const results = await runAllTests(options);
    const report = generateReport(results, options.season);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printConsoleReport(report, options.verbose);
    }

    // Disconnect from database
    await prisma.$disconnect();

    // Exit with appropriate code
    if (report.criticalIssues.length > 0) {
      process.exit(1);
    } else if (report.summary.failed > 0) {
      process.exit(2);
    } else {
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ UAT Runner Failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
