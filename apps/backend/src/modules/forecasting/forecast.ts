/**
 * Pure sales-forecast math (no I/O). "Simple, transparent forecast to decide
 * staffing/stock" (PROJECT_SPEC §7.7, ROADMAP Phase 4): a linear trend over
 * daily revenue plus an additive day-of-week seasonal adjustment — no
 * black-box model, every number in the response is derivable by hand from
 * the history it returns.
 *
 * Money is computed in integer cents throughout to avoid binary-float drift,
 * the same convention as the invoices module.
 */
import { FORECAST_MIN_DATA_POINTS } from './sales-forecast.constants';

export interface DailyPoint {
  date: string;
  revenueCents: number;
}

export interface ForecastPoint {
  date: string;
  revenue: string;
}

export type ForecastMethod =
  'linear_trend_plus_day_of_week_seasonality' | 'insufficient_data_flat_average';

export interface SalesForecastResult {
  history: ForecastPoint[];
  forecast: ForecastPoint[];
  trend: { dailySlope: string };
  seasonality: Record<string, string>;
  method: ForecastMethod;
  insufficientData: boolean;
}

const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Buckets raw revenue rows into one entry per UTC calendar day over
 * `[from, to)` (both must already be UTC midnights), filling gaps with 0.
 */
export function bucketDailyRevenue(
  rows: readonly { createdAt: Date; totalCents: number }[],
  from: Date,
  to: Date,
): DailyPoint[] {
  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    buckets.set(toDateKey(addUtcDays(from, i)), 0);
  }
  for (const row of rows) {
    const key = toDateKey(startOfUtcDay(row.createdAt));
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + row.totalCents);
    }
  }
  return [...buckets.entries()].map(([date, revenueCents]) => ({ date, revenueCents }));
}

/** Ordinary least squares of `revenueCents` against its own index (0..n-1). */
export function fitLinearTrend(points: readonly DailyPoint[]): {
  slope: number;
  intercept: number;
} {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].revenueCents };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  points.forEach((point, x) => {
    sumX += x;
    sumY += point.revenueCents;
    sumXY += x * point.revenueCents;
    sumXX += x * x;
  });
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/** Average trend residual per weekday (index 0=Sun..6=Sat); 0 where no data falls on that weekday. */
export function weekdaySeasonality(
  points: readonly DailyPoint[],
  trend: { slope: number; intercept: number },
): number[] {
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  points.forEach((point, x) => {
    const weekday = new Date(`${point.date}T00:00:00Z`).getUTCDay();
    const residual = point.revenueCents - (trend.intercept + trend.slope * x);
    sums[weekday] += residual;
    counts[weekday] += 1;
  });
  return sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : 0));
}

/**
 * Builds the forecast: `points` is the complete daily history ending the day
 * before `forecastStart` (both UTC midnights); `horizonDays` future points
 * are returned starting at `forecastStart`. Falls back to a flat average
 * (no trend/seasonality) when fewer than `FORECAST_MIN_DATA_POINTS` days in
 * the window carry any revenue at all — too little signal for a trend line
 * to mean anything.
 */
export function buildSalesForecast(
  points: readonly DailyPoint[],
  horizonDays: number,
  forecastStart: Date,
): SalesForecastResult {
  const history = points.map((point) => ({
    date: point.date,
    revenue: fromCents(point.revenueCents),
  }));
  const daysWithRevenue = points.filter((point) => point.revenueCents !== 0).length;
  const insufficientData = daysWithRevenue < FORECAST_MIN_DATA_POINTS;

  if (insufficientData) {
    const average =
      points.length > 0
        ? points.reduce((sum, point) => sum + point.revenueCents, 0) / points.length
        : 0;
    const flat = Math.max(0, Math.round(average));
    const forecast: ForecastPoint[] = Array.from({ length: horizonDays }, (_, i) => ({
      date: toDateKey(addUtcDays(forecastStart, i)),
      revenue: fromCents(flat),
    }));
    return {
      history,
      forecast,
      trend: { dailySlope: '0.00' },
      seasonality: Object.fromEntries(WEEKDAY_LABELS.map((label) => [label, '0.00'])),
      method: 'insufficient_data_flat_average',
      insufficientData: true,
    };
  }

  const trend = fitLinearTrend(points);
  const seasonality = weekdaySeasonality(points, trend);
  const forecast: ForecastPoint[] = Array.from({ length: horizonDays }, (_, i) => {
    const x = points.length + i;
    const date = addUtcDays(forecastStart, i);
    const weekday = date.getUTCDay();
    const predicted = trend.intercept + trend.slope * x + seasonality[weekday];
    return { date: toDateKey(date), revenue: fromCents(Math.max(0, Math.round(predicted))) };
  });

  return {
    history,
    forecast,
    trend: { dailySlope: fromCents(trend.slope) },
    seasonality: Object.fromEntries(
      WEEKDAY_LABELS.map((label, i) => [label, fromCents(Math.round(seasonality[i]))]),
    ),
    method: 'linear_trend_plus_day_of_week_seasonality',
    insufficientData: false,
  };
}
