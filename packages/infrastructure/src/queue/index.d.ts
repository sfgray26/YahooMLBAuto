/**
 * Redis Queue Configuration
 * Uses BullMQ for reliable job processing
 */
import { Queue, Job } from 'bullmq';
import Redis from 'ioredis';
export declare const redisConnection: Redis;
export declare const QueueNames: {
    readonly DECISION_REQUESTS: "decision-requests";
    readonly DATA_SYNC: "data-sync";
    readonly VALUATION_GENERATION: "valuation-generation";
    readonly ANALYTICS_JOBS: "analytics-jobs";
    readonly ALERTS: "alerts";
};
export interface DecisionRequestJob {
    type: 'lineup_optimization' | 'waiver_recommendation' | 'player_valuation';
    payload: unknown;
    traceId: string;
    priority: number;
}
export interface DataSyncJob {
    type: 'player_data' | 'schedule' | 'weather' | 'scores';
    date?: string;
    forceRefresh?: boolean;
}
export interface ValuationJob {
    playerIds: string[];
    scoringPeriod: {
        start: string;
        end: string;
    };
    traceId: string;
}
export interface AnalyticsJob {
    type: 'monte_carlo_sim' | 'factor_update' | 'model_retrain';
    parameters: Record<string, unknown>;
}
export interface AlertJob {
    type: 'high_confidence_decision' | 'manual_review_required' | 'daily_digest';
    decisionId?: string;
    message: string;
    metadata: Record<string, unknown>;
}
export declare const decisionQueue: Queue<DecisionRequestJob, any, string, DecisionRequestJob, any, string>;
export declare const dataSyncQueue: Queue<DataSyncJob, any, string, DataSyncJob, any, string>;
export declare const valuationQueue: Queue<ValuationJob, any, string, ValuationJob, any, string>;
export declare const analyticsQueue: Queue<AnalyticsJob, any, string, AnalyticsJob, any, string>;
export declare const alertQueue: Queue<AlertJob, any, string, AlertJob, any, string>;
export declare function addDecisionRequest(type: DecisionRequestJob['type'], payload: unknown, traceId: string, priority?: number): Promise<Job>;
export declare function addDataSync(type: DataSyncJob['type'], options?: {
    date?: string;
    forceRefresh?: boolean;
}): Promise<Job>;
export declare function addValuationJob(playerIds: string[], scoringPeriod: {
    start: string;
    end: string;
}, traceId: string): Promise<Job>;
export declare function addAlert(type: AlertJob['type'], message: string, metadata?: Record<string, unknown>, decisionId?: string): Promise<Job>;
export declare function closeQueues(): Promise<void>;
//# sourceMappingURL=index.d.ts.map