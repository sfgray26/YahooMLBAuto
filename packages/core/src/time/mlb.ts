import type { ScoringPeriod } from '../decisions/index.js';

export const MLB_TIME_ZONE = 'America/New_York';

export type MlbScoringPeriodPreset = 'today' | 'tomorrow' | 'week';

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

export interface MlbWallClock extends CalendarDateParts {
  isoDate: string;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  offset: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getMlbWallClock(referenceDate: Date = new Date()): MlbWallClock {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MLB_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });

  const parts = formatter.formatToParts(referenceDate);
  const year = Number(getPart(parts, 'year'));
  const month = Number(getPart(parts, 'month'));
  const day = Number(getPart(parts, 'day'));
  const hour = Number(getPart(parts, 'hour'));
  const minute = Number(getPart(parts, 'minute'));
  const second = Number(getPart(parts, 'second'));
  const weekday = WEEKDAY_INDEX[getPart(parts, 'weekday')];

  return {
    year,
    month,
    day,
    isoDate: formatDate({ year, month, day }),
    hour,
    minute,
    second,
    weekday,
    offset: normalizeOffset(getPart(parts, 'timeZoneName')),
  };
}

export function buildMlbScoringPeriod(
  preset: MlbScoringPeriodPreset,
  referenceDate: Date = new Date()
): Pick<ScoringPeriod, 'type' | 'startDate' | 'endDate'> {
  const wallClock = getMlbWallClock(referenceDate);
  const today = {
    year: wallClock.year,
    month: wallClock.month,
    day: wallClock.day,
  };

  if (preset === 'today') {
    return {
      type: 'daily',
      startDate: formatBoundary(today, '00:00:00'),
      endDate: formatBoundary(today, '23:59:59'),
    };
  }

  if (preset === 'tomorrow') {
    const tomorrow = addDays(today, 1);
    return {
      type: 'daily',
      startDate: formatBoundary(tomorrow, '00:00:00'),
      endDate: formatBoundary(tomorrow, '23:59:59'),
    };
  }

  const daysSinceMonday = wallClock.weekday === 0 ? 6 : wallClock.weekday - 1;
  const weekStart = addDays(today, -daysSinceMonday);
  const weekEnd = addDays(weekStart, 6);

  return {
    type: 'weekly',
    startDate: formatBoundary(weekStart, '00:00:00'),
    endDate: formatBoundary(weekEnd, '23:59:59'),
  };
}

function addDays(date: CalendarDateParts, days: number): CalendarDateParts {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  utc.setUTCDate(utc.getUTCDate() + days);

  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function formatBoundary(date: CalendarDateParts, time: string): string {
  return `${formatDate(date)}T${time}${getOffsetForDate(date)}`;
}

function formatDate(date: CalendarDateParts): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function getOffsetForDate(date: CalendarDateParts): string {
  const middayUtc = new Date(Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0));
  return getMlbWallClock(middayUtc).offset;
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((part) => part.type === type)?.value;

  if (!value) {
    throw new Error(`Missing ${type} in MLB time formatter output`);
  }

  return value;
}

function normalizeOffset(value: string): string {
  if (value === 'GMT' || value === 'UTC') {
    return '+00:00';
  }

  const match = value.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    throw new Error(`Unsupported timezone offset format: ${value}`);
  }

  const [, sign, hours, minutes] = match;
  return `${sign}${hours.padStart(2, '0')}:${(minutes ?? '00').padStart(2, '0')}`;
}
