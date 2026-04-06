/**
 * Trade Evaluator Formatter
 *
 * Formats trade evaluation results for human consumption.
 * Supports multiple output formats: text, markdown, JSON.
 */

import type { TradeEvaluation, TradeSideAnalysis, TradePlayer } from './types.js';

export interface FormatOptions {
  format: 'text' | 'markdown' | 'json';
  verbose: boolean;
  includeTrace: boolean;
}

const DEFAULT_OPTIONS: FormatOptions = {
  format: 'text',
  verbose: false,
  includeTrace: false,
};

/**
 * Format trade evaluation for output
 */
export function formatTradeEvaluation(
  analysis: TradeSideAnalysis,
  options: Partial<FormatOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const eval_ = analysis.forYourTeam;
  
  switch (opts.format) {
    case 'markdown':
      return formatAsMarkdown(analysis, opts);
    case 'json':
      return formatAsJson(analysis, opts);
    case 'text':
    default:
      return formatAsText(analysis, opts);
  }
}

function formatAsText(analysis: TradeSideAnalysis, opts: FormatOptions): string {
  const eval_ = analysis.forYourTeam;
  const lines: string[] = [];
  
  // Header
  lines.push('='.repeat(60));
  lines.push('TRADE EVALUATION REPORT');
  lines.push('='.repeat(60));
  lines.push('');
  
  // Recommendation
  lines.push(formatRecommendationBox(eval_.recommendation, eval_.summaryScore));
  lines.push('');
  
  // Summary
  lines.push('SUMMARY');
  lines.push('-'.repeat(40));
  lines.push(eval_.explanation.summary);
  lines.push('');
  
  // Key points
  if (eval_.explanation.keyPoints.length > 0) {
    lines.push('KEY POINTS');
    lines.push('-'.repeat(40));
    for (const point of eval_.explanation.keyPoints) {
      lines.push(`  ✓ ${point}`);
    }
    lines.push('');
  }
  
  // Concerns
  if (eval_.explanation.concerns.length > 0) {
    lines.push('CONCERNS');
    lines.push('-'.repeat(40));
    for (const concern of eval_.explanation.concerns) {
      lines.push(`  ⚠ ${concern}`);
    }
    lines.push('');
  }
  
  // Category impact
  lines.push('CATEGORY IMPACT');
  lines.push('-'.repeat(40));
  lines.push(eval_.explanation.categoryNarrative);
  lines.push('');
  if (opts.verbose) {
    for (const [cat, change] of Object.entries(eval_.categoryImpact.statChanges)) {
      const symbol = change > 0 ? '↑' : change < 0 ? '↓' : '→';
      lines.push(`  ${symbol} ${cat}: ${change > 0 ? '+' : ''}${change.toFixed(1)}`);
    }
    lines.push('');
  }
  
  // Risk impact
  lines.push('RISK IMPACT');
  lines.push('-'.repeat(40));
  lines.push(eval_.explanation.riskNarrative);
  lines.push('');
  
  // Roster impact
  lines.push('ROSTER IMPACT');
  lines.push('-'.repeat(40));
  lines.push(eval_.explanation.rosterNarrative);
  lines.push('');
  
  // Verdict
  lines.push('VERDICT');
  lines.push('-'.repeat(40));
  lines.push(eval_.explanation.verdict);
  lines.push('');
  
  // Fairness
  lines.push('FAIRNESS ASSESSMENT');
  lines.push('-'.repeat(40));
  lines.push(`  Trade fairness: ${formatFairness(analysis.fairness)}`);
  lines.push(`  Likelihood opponent accepts: ${formatLikelihood(analysis.likelihoodOfAcceptance)}`);
  lines.push('');
  
  // World comparison
  if (opts.verbose) {
    lines.push('WORLD COMPARISON');
    lines.push('-'.repeat(40));
    lines.push(`  Current standing: ${eval_.worldBefore.projectedStanding}`);
    lines.push(`  Post-trade standing: ${eval_.worldAfter.projectedStanding}`);
    lines.push(`  Standing change: ${eval_.delta.standingChange > 0 ? '+' : ''}${eval_.delta.standingChange} spots`);
    lines.push('');
    lines.push(`  Current category points: ${eval_.worldBefore.projectedCategoryPoints.toFixed(1)}`);
    lines.push(`  Post-trade points: ${eval_.worldAfter.projectedCategoryPoints.toFixed(1)}`);
    lines.push(`  Points change: ${eval_.delta.categoryPointsChange > 0 ? '+' : ''}${eval_.delta.categoryPointsChange.toFixed(1)}`);
    lines.push('');
  }
  
  // Trace
  if (opts.includeTrace && eval_.decisionTrace.length > 0) {
    lines.push('DECISION TRACE');
    lines.push('-'.repeat(40));
    for (const step of eval_.decisionTrace) {
      const impact = step.impact !== 0 ? ` (${step.impact > 0 ? '+' : ''}${step.impact.toFixed(1)})` : '';
      lines.push(`  ${step.step}. ${step.description}${impact}`);
    }
    lines.push('');
  }
  
  lines.push('='.repeat(60));
  
  return lines.join('\n');
}

function formatAsMarkdown(analysis: TradeSideAnalysis, opts: FormatOptions): string {
  const eval_ = analysis.forYourTeam;
  const lines: string[] = [];
  
  lines.push('# Trade Evaluation Report');
  lines.push('');
  
  // Recommendation badge
  const recBadge = formatRecommendationBadge(eval_.recommendation);
  lines.push(`**Recommendation:** ${recBadge}`);
  lines.push(`**Trade Value:** ${eval_.summaryScore > 0 ? '+' : ''}${eval_.summaryScore.toFixed(1)}`);
  lines.push(`**Confidence:** ${eval_.confidence}`);
  lines.push('');
  
  lines.push('## Summary');
  lines.push(eval_.explanation.summary);
  lines.push('');
  
  if (eval_.explanation.keyPoints.length > 0) {
    lines.push('## Key Points');
    for (const point of eval_.explanation.keyPoints) {
      lines.push(`- ✓ ${point}`);
    }
    lines.push('');
  }
  
  if (eval_.explanation.concerns.length > 0) {
    lines.push('## Concerns');
    for (const concern of eval_.explanation.concerns) {
      lines.push(`- ⚠ ${concern}`);
    }
    lines.push('');
  }
  
  lines.push('## Category Impact');
  lines.push(eval_.explanation.categoryNarrative);
  lines.push('');
  
  if (opts.verbose) {
    lines.push('| Category | Change |');
    lines.push('|----------|--------|');
    for (const [cat, change] of Object.entries(eval_.categoryImpact.statChanges)) {
      const emoji = change > 0 ? '📈' : change < 0 ? '📉' : '➡️';
      lines.push(`| ${cat} | ${emoji} ${change > 0 ? '+' : ''}${change.toFixed(1)} |`);
    }
    lines.push('');
  }
  
  lines.push('## Risk Impact');
  lines.push(eval_.explanation.riskNarrative);
  lines.push('');
  
  lines.push('## Roster Impact');
  lines.push(eval_.explanation.rosterNarrative);
  lines.push('');
  
  lines.push('## Verdict');
  lines.push(`> ${eval_.explanation.verdict}`);
  lines.push('');
  
  lines.push('---');
  lines.push('*Generated by Trade Evaluator v1.0*');
  
  return lines.join('\n');
}

function formatAsJson(analysis: TradeSideAnalysis, opts: FormatOptions): string {
  if (!opts.verbose) {
    // Simplified JSON
    const simplified = {
      recommendation: analysis.forYourTeam.recommendation,
      score: analysis.forYourTeam.summaryScore,
      confidence: analysis.forYourTeam.confidence,
      summary: analysis.forYourTeam.explanation.summary,
      keyPoints: analysis.forYourTeam.explanation.keyPoints,
      concerns: analysis.forYourTeam.explanation.concerns,
      fairness: analysis.fairness,
      likelihoodOfAcceptance: analysis.likelihoodOfAcceptance,
    };
    return JSON.stringify(simplified, null, 2);
  }
  
  return JSON.stringify(analysis, null, 2);
}

function formatRecommendationBox(rec: string, score: number): string {
  const recText = rec.replace(/_/g, ' ').toUpperCase();
  const scoreText = `${score > 0 ? '+' : ''}${score.toFixed(1)}`;
  
  const width = 40;
  const line = '═'.repeat(width);
  const empty = ' ' .repeat(width - 2);
  
  const lines: string[] = [];
  lines.push(`╔${line}╗`);
  lines.push(`║${empty}║`);
  lines.push(`║${centerText(recText, width)}║`);
  lines.push(`║${centerText(scoreText, width)}║`);
  lines.push(`║${empty}║`);
  lines.push(`╚${line}╝`);
  
  return lines.join('\n');
}

function centerText(text: string, width: number): string {
  const padding = Math.max(0, width - 2 - text.length);
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return ' ' + ' '.repeat(left) + text + ' '.repeat(right);
}

function formatRecommendationBadge(rec: string): string {
  const badges: Record<string, string> = {
    strong_accept: '🟢 **STRONG ACCEPT**',
    lean_accept: '🟡 **LEAN ACCEPT**',
    neutral: '⚪ **NEUTRAL**',
    lean_reject: '🟠 **LEAN REJECT**',
    hard_reject: '🔴 **HARD REJECT**',
  };
  return badges[rec] || rec;
}

function formatFairness(fairness: string): string {
  const map: Record<string, string> = {
    lopsided_you: 'Heavily in your favor',
    slight_you: 'Slightly in your favor',
    fair: 'Fair / Even',
    slight_them: 'Slightly in their favor',
    lopsided_them: 'Heavily in their favor',
  };
  return map[fairness] || fairness;
}

function formatLikelihood(likelihood: string): string {
  const map: Record<string, string> = {
    high: 'High - they should accept',
    medium: 'Medium - negotiate needed',
    low: 'Low - theyll likely reject',
  };
  return map[likelihood] || likelihood;
}

/**
 * Format player summary for trade display
 */
export function formatPlayerList(players: TradePlayer[]): string {
  if (players.length === 0) return '  (none)';
  
  return players.map(p => {
    const score = p.score ? `[${p.score.overallValue.toFixed(0)}]` : '';
    const positions = p.positions.join('/');
    const momentum = p.momentum ? ` ${p.momentum.trend}` : '';
    return `  - ${p.name} ${score} (${positions})${momentum}`;
  }).join('\n');
}

/**
 * Create a one-line summary
 */
export function formatOneLine(analysis: TradeSideAnalysis): string {
  const eval_ = analysis.forYourTeam;
  const emoji = eval_.recommendation.includes('accept') ? '✓' : 
                eval_.recommendation.includes('reject') ? '✗' : '→';
  return `${emoji} ${eval_.recommendation.replace(/_/g, ' ').toUpperCase()} (${eval_.summaryScore > 0 ? '+' : ''}${eval_.summaryScore.toFixed(1)}) - ${eval_.explanation.summary}`;
}
