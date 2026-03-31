/**
 * Core Decision Contracts
 * 
 * These contracts are the immutable records that flow through the system.
 * They are the single source of truth for all decisions.
 * 
 * Rules:
 * - All properties are readonly
 * - No methods, only data
 * - Serializable to JSON
 * - Versioned for migration safety
 */

// ============================================================================
// Shared Primitives
// ============================================================================

export type UUID = string;
export type ISO8601Timestamp = string;
export type Percentage = number; // 0.0 - 1.0

export interface PlayerIdentity {
  readonly id: UUID;
  readonly mlbamId: string;
  readonly name: string;
  readonly team: string;
  readonly position: string[];
}

export interface FantasyEntity {
  readonly type: 'player' | 'team' | 'lineup_slot';
  readonly id: UUID;
  readonly platformId?: string;
}

export type ConfidenceLevel = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
export type RiskLevel = 'low' | 'moderate' | 'high' | 'extreme';

// ============================================================================
// Decision Contract 1: LineupOptimizationRequest
// ============================================================================

export interface LineupOptimizationRequest {
  readonly id: UUID;
  readonly version: 'v1';
  readonly createdAt: ISO8601Timestamp;
  readonly leagueConfig: LeagueConfiguration;
  readonly scoringPeriod: ScoringPeriod;
  readonly rosterConstraints: RosterConstraints;
  readonly availablePlayers: PlayerPool;
  readonly optimizationObjective: OptimizationObjective;
  readonly riskTolerance: RiskProfile;
  readonly weatherSensitivity?: WeatherSensitivity;
  readonly correlationPreferences?: CorrelationPreferences;
  readonly manualOverrides?: ManualOverride[];
}

export interface LeagueConfiguration {
  readonly platform: 'yahoo' | 'espn' | 'fantrax' | 'sleeper' | 'custom';
  readonly format: 'h2h' | 'roto' | 'points';
  readonly scoringRules: ScoringRules;
  readonly rosterPositions: RosterPosition[];
  readonly leagueSize: number;
  readonly categories?: string[];
}

export interface ScoringRules {
  readonly batting: Record<string, number>;
  readonly pitching: Record<string, number>;
}

export interface RosterPosition {
  readonly slot: string;
  readonly maxCount: number;
  readonly eligiblePositions: string[];
}

export interface ScoringPeriod {
  readonly type: 'daily' | 'weekly' | 'season';
  readonly startDate: ISO8601Timestamp;
  readonly endDate: ISO8601Timestamp;
  readonly games: ScheduledGame[];
}

export interface ScheduledGame {
  readonly id: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly startTime: ISO8601Timestamp;
  readonly ballpark: string;
  readonly weatherForecast?: WeatherForecast;
}

export interface WeatherForecast {
  readonly temperature: number;
  readonly condition: string;
  readonly precipitationChance: Percentage;
  readonly windSpeed: number;
  readonly windDirection: string;
}

export interface PlayerPool {
  readonly players: PoolPlayer[];
  readonly lastUpdated: ISO8601Timestamp;
}

export interface PoolPlayer {
  readonly player: PlayerIdentity;
  readonly isAvailable: boolean;
  readonly currentRosterStatus?: 'starting' | 'bench' | 'injured' | 'minors';
  readonly acquisitionCost?: number;
}

export interface RosterConstraints {
  readonly lockedSlots: string[];
  readonly mustInclude?: UUID[];
  readonly mustExclude?: UUID[];
  readonly maxExposurePerTeam?: Percentage;
}

export interface OptimizationObjective {
  readonly type: 'maximize_expected' | 'maximize_floor' | 'maximize_ceiling' | 'balanced';
  readonly constraints?: {
    readonly maxExposurePerPlayer?: Percentage;
    readonly stackPreferences?: StackPreference[];
    readonly diversificationTarget?: Percentage;
  };
}

export interface StackPreference {
  readonly team: string;
  readonly weight: number;
  readonly maxPlayers: number;
}

export type RiskProfile = 
  | { readonly type: 'conservative'; varianceTolerance: 0.1; description: 'Minimize downside' }
  | { readonly type: 'balanced'; varianceTolerance: 0.3; description: 'Balance risk and reward' }
  | { readonly type: 'aggressive'; varianceTolerance: 0.5; description: 'Maximize upside potential' };

export interface WeatherSensitivity {
  readonly rainThreshold: Percentage;
  readonly windThreshold: number;
  readonly temperatureThreshold: { min: number; max: number };
}

export interface CorrelationPreferences {
  readonly favorTeamStacks: boolean;
  readonly avoidPitcherVsBatter: boolean;
  readonly favorOpposingLineups: boolean;
}

export interface ManualOverride {
  readonly playerId: UUID;
  readonly action: 'lock_in' | 'lock_out' | 'boost_projection';
  readonly value?: number;
  readonly reason?: string;
}

// ============================================================================
// Decision Contract 2: PlayerValuationReport
// ============================================================================

export interface PlayerValuationReport {
  readonly id: UUID;
  readonly version: 'v1';
  readonly generatedAt: ISO8601Timestamp;
  readonly validUntil: ISO8601Timestamp;
  readonly player: PlayerIdentity;
  readonly context: ValuationContext;
  readonly pointProjection: Distribution;
  readonly valueOverReplacement: number;
  readonly positionalScarcity: PositionalScarcity;
  readonly riskProfile: PlayerRiskProfile;
  readonly floorProjection: number;
  readonly ceilingProjection: number;
  readonly factors: AppliedFactor[];
  readonly methodology: ValuationMethodology;
  readonly dataSources: DataSourceReference[];
}

export interface Distribution {
  readonly mean: number;
  readonly median: number;
  readonly standardDeviation: number;
  readonly variance: number;
  readonly percentiles: PercentileDistribution;
  readonly histogramBins?: HistogramBin[];
}

export interface PercentileDistribution {
  readonly p5: number;
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p95: number;
}

export interface HistogramBin {
  readonly min: number;
  readonly max: number;
  readonly count: number;
  readonly density: Percentage;
}

export interface ValuationContext {
  readonly scoringPeriod: ScoringPeriod;
  readonly leagueScoring: ScoringRules;
  readonly opponent?: string;
  readonly ballpark?: string;
  readonly lineupSpot?: number;
}

export interface PositionalScarcity {
  readonly position: string;
  readonly replacementLevel: number;
  readonly availableAlternatives: number;
  readonly scarcityScore: number;
}

export interface PlayerRiskProfile {
  readonly injuryRisk: RiskLevel;
  readonly playingTimeRisk: RiskLevel;
  readonly performanceVariance: RiskLevel;
  readonly overallRisk: RiskLevel;
  readonly confidenceInterval: { lower: number; upper: number };
}

export interface AppliedFactor {
  readonly factorType: FactorType;
  readonly impact: number;
  readonly confidence: ConfidenceLevel;
  readonly rawData: unknown;
}

export type FactorType = 
  | 'weather'
  | 'ballpark'
  | 'platoon_split'
  | 'rest'
  | 'momentum'
  | 'lineup_position'
  | 'opponent_quality';

export interface ValuationMethodology {
  readonly modelType: 'monte_carlo' | 'ensemble' | 'regression' | 'hybrid';
  readonly simulationCount?: number;
  readonly featuresUsed: string[];
  readonly modelVersion: string;
  readonly trainedAt: ISO8601Timestamp;
}

export interface DataSourceReference {
  readonly source: string;
  readonly endpoint: string;
  readonly fetchedAt: ISO8601Timestamp;
  readonly cacheKey: string;
}

// ============================================================================
// Decision Contract 3: ExecutionDecision
// ============================================================================

export interface ExecutionDecision {
  readonly id: UUID;
  readonly version: 'v1';
  readonly createdAt: ISO8601Timestamp;
  readonly decisionType: DecisionType;
  readonly target: FantasyEntity;
  readonly recommendedAction: RecommendedAction;
  readonly reasoning: DecisionReasoning;
  readonly confidence: ConfidenceLevel;
  readonly alternativeActions: AlternativeAction[];
  readonly executionMode: ExecutionMode;
  readonly humanReviewRequired: boolean;
  readonly autoExecuteConditions?: AutoExecuteCondition[];
  readonly sourceRequestId?: UUID;
  readonly traceId: UUID;
}

export type DecisionType =
  | 'set_lineup'
  | 'add_player'
  | 'drop_player'
  | 'claim_waiver'
  | 'trade_proposal'
  | 'sit_player'
  | 'start_player';

export interface RecommendedAction {
  readonly type: string;
  readonly parameters: Record<string, unknown>;
  readonly expectedOutcome: ExpectedOutcome;
  readonly riskAssessment: RiskAssessment;
  readonly urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface ExpectedOutcome {
  readonly pointImpact: number;
  readonly categoryImpacts?: Record<string, number>;
  readonly winProbabilityDelta?: Percentage;
  readonly description: string;
}

export interface RiskAssessment {
  readonly downsideScenario: string;
  readonly worstCaseImpact: number;
  readonly probabilityOfSuccess: Percentage;
  readonly keyRisks: string[];
}

export interface DecisionReasoning {
  readonly summary: string;
  readonly primaryFactor: string;
  readonly supportingFactors: string[];
  readonly counterIndicators: string[];
  readonly keyAssumptions: string[];
  readonly projectionDelta: number;
}

export interface AlternativeAction {
  readonly action: string;
  readonly parameters: Record<string, unknown>;
  readonly expectedValue: number;
  readonly confidence: ConfidenceLevel;
  readonly whyNotRecommended: string;
}

export type ExecutionMode =
  | { readonly type: 'manual_review'; reason: string }
  | { readonly type: 'suggest_only' }
  | { 
      readonly type: 'auto_if_confident'; 
      minConfidence: ConfidenceLevel; 
      maxRiskScore: number;
      requiredConditions: string[];
    }
  | { 
      readonly type: 'full_auto'; 
      constraints: AutoExecuteConstraint[];
      dailyDigest: boolean;
    };

export interface AutoExecuteCondition {
  readonly metric: string;
  readonly operator: 'gt' | 'lt' | 'eq' | 'between';
  readonly value: number | [number, number];
  readonly currentValue: number;
  readonly satisfied: boolean;
}

export interface AutoExecuteConstraint {
  readonly type: 'max_daily_moves' | 'preserve_faab' | 'avoid_drop_list' | 'position_depth';
  readonly parameters: Record<string, unknown>;
}

// ============================================================================
// Result Contracts (Outputs of the system)
// ============================================================================

export interface LineupOptimizationResult {
  readonly requestId: UUID;
  readonly generatedAt: ISO8601Timestamp;
  readonly optimalLineup: LineupSlot[];
  readonly expectedPoints: number;
  readonly confidenceScore: number;
  readonly alternativeLineups: AlternativeLineup[];
  readonly explanation: LineupExplanation;
}

export interface LineupSlot {
  readonly position: string;
  readonly player: PlayerIdentity;
  readonly projectedPoints: number;
  readonly confidence: ConfidenceLevel;
  readonly factors: string[];
}

export interface AlternativeLineup {
  readonly lineup: LineupSlot[];
  readonly expectedPoints: number;
  readonly varianceVsOptimal: number;
  readonly tradeoffDescription: string;
}

export interface LineupExplanation {
  readonly summary: string;
  readonly keyDecisions: KeyDecisionPoint[];
  readonly riskFactors: string[];
  readonly opportunities: string[];
}

export interface KeyDecisionPoint {
  readonly position: string;
  readonly chosenPlayer: PlayerIdentity;
  readonly alternativesConsidered: PlayerIdentity[];
  readonly whyChosen: string;
}

// ============================================================================
// Waiver Contract Extensions
// ============================================================================

export interface WaiverRecommendationRequest {
  readonly id: UUID;
  readonly version: 'v1';
  readonly createdAt: ISO8601Timestamp;
  readonly leagueConfig: LeagueConfiguration;
  readonly currentRoster: RosterSlot[];
  readonly availablePlayers: PlayerPool;
  readonly recommendationScope: 'add_only' | 'drop_only' | 'add_drop' | 'full_optimization';
  readonly rosterNeeds?: RosterNeeds;
}

export interface RosterSlot {
  readonly player: PlayerIdentity;
  readonly position: string;
  readonly isLocked: boolean;
}

export interface RosterNeeds {
  readonly positionalNeeds: Record<string, 'none' | 'moderate' | 'high' | 'critical'>;
  readonly categoryNeeds?: Record<string, 'surplus' | 'adequate' | 'deficit'>;
  readonly preferredUpside?: boolean;
}

export interface WaiverRecommendationResult {
  readonly requestId: UUID;
  readonly generatedAt: ISO8601Timestamp;
  readonly recommendations: WaiverRecommendation[];
  readonly rosterAnalysis: RosterAnalysis;
}

export interface WaiverRecommendation {
  readonly rank: number;
  readonly player: PlayerIdentity;
  readonly action: 'add' | 'drop' | 'swap';
  readonly dropCandidate?: PlayerIdentity;
  readonly expectedValue: number;
  readonly confidence: ConfidenceLevel;
  readonly reasoning: string;
  readonly urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface RosterAnalysis {
  readonly strengths: string[];
  readonly weaknesses: string[];
  readonly opportunities: string[];
  readonly categoryStandings?: Record<string, number>;
}

// ============================================================================
// Event Contracts (For async communication)
// ============================================================================

export interface DecisionEvent {
  readonly eventId: UUID;
  readonly eventType: 
    | 'optimization_requested'
    | 'valuation_completed'
    | 'decision_created'
    | 'decision_approved'
    | 'decision_rejected';
  readonly timestamp: ISO8601Timestamp;
  readonly payload: unknown;
  readonly metadata: EventMetadata;
}

export interface EventMetadata {
  readonly source: string;
  readonly traceId: UUID;
  readonly correlationId?: UUID;
  readonly userId?: string;
}
