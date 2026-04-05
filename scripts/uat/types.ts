/**
 * UAT Framework Types
 * Foundation Integrity Test Contracts
 */

export interface UATTestResult {
  testName: string;
  category: 'row_count' | 'duplicates' | 'stat_inflation' | 'completeness' | 'reconciliation';
  status: 'pass' | 'fail' | 'warning';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  durationMs: number;
}

export interface UATReport {
  runId: string;
  timestamp: Date;
  season: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  results: UATTestResult[];
  criticalIssues: string[];
}

export interface DriftCheckConfig {
  season: number;
  acceptableVariancePercent: number;
  sampleSize?: number;
}

export interface DuplicateCheckConfig {
  season: number;
  tables: Array<'playerGameLog' | 'playerDailyStats' | 'rawIngestionLog'>;
}

export interface StatAggregationConfig {
  season: number;
  playerMlbamIds: string[];
  statsToValidate: Array<
    'gamesPlayed' | 'atBats' | 'hits' | 'homeRuns' | 'rbi' | 'runs' | 
    'walks' | 'strikeouts' | 'stolenBases' | 'totalBases'
  >;
}

export interface CompletenessConfig {
  season: number;
  expectedPlayers: string[];
  dateRange: { start: Date; end: Date };
}

export interface ReconciliationConfig {
  season: number;
  sampleSize: number;
}
