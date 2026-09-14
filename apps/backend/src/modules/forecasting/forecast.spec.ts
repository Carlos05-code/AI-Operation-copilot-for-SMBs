/**
 * Unit tests — pure sales-forecast math (bucketing, trend, seasonality, forecast).
 */
import {
  addUtcDays,
  bucketDailyRevenue,
  buildSalesForecast,
  fitLinearTrend,
  startOfUtcDay,
  weekdaySeasonality,
  type DailyPoint,
} from './forecast';

const DAY = 24 * 60 * 60 * 1000;
const D0 = new Date('2026-01-01T00:00:00Z'); // a Thursday

describe('bucketDailyRevenue', () => {
  it('fills every day in the window with 0 and sums rows landing on the same day', () => {
    const rows = [
      { createdAt: new Date('2026-01-01T09:00:00Z'), totalCents: 1000 },
      { createdAt: new Date('2026-01-01T18:00:00Z'), totalCents: 500 },
      { createdAt: new Date('2026-01-03T10:00:00Z'), totalCents: 200 },
    ];
    const points = bucketDailyRevenue(rows, D0, addUtcDays(D0, 4));
    expect(points).toEqual([
      { date: '2026-01-01', revenueCents: 1500 },
      { date: '2026-01-02', revenueCents: 0 },
      { date: '2026-01-03', revenueCents: 200 },
      { date: '2026-01-04', revenueCents: 0 },
    ]);
  });

  it('ignores rows outside the window', () => {
    const rows = [{ createdAt: new Date('2025-12-31T00:00:00Z'), totalCents: 9999 }];
    const points = bucketDailyRevenue(rows, D0, addUtcDays(D0, 1));
    expect(points).toEqual([{ date: '2026-01-01', revenueCents: 0 }]);
  });
});

describe('startOfUtcDay / addUtcDays', () => {
  it('truncates to UTC midnight and adds whole days', () => {
    expect(startOfUtcDay(new Date('2026-03-05T17:42:00Z')).toISOString()).toBe(
      '2026-03-05T00:00:00.000Z',
    );
    expect(addUtcDays(D0, 3).getTime()).toBe(D0.getTime() + 3 * DAY);
  });
});

describe('fitLinearTrend', () => {
  it('recovers the exact slope and intercept of a perfectly linear series', () => {
    const points: DailyPoint[] = [0, 1, 2, 3, 4].map((i) => ({
      date: `d${i}`,
      revenueCents: 1000 + i * 200,
    }));
    expect(fitLinearTrend(points)).toEqual({ slope: 200, intercept: 1000 });
  });

  it('returns zeros for no data and a flat line for one point', () => {
    expect(fitLinearTrend([])).toEqual({ slope: 0, intercept: 0 });
    expect(fitLinearTrend([{ date: 'd0', revenueCents: 500 }])).toEqual({
      slope: 0,
      intercept: 500,
    });
  });
});

describe('weekdaySeasonality', () => {
  it('is all zero when the series exactly matches the trend', () => {
    const points: DailyPoint[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      date: toDateKey(addUtcDays(D0, i)),
      revenueCents: 1000 + i * 100,
    }));
    const trend = fitLinearTrend(points);
    expect(weekdaySeasonality(points, trend)).toEqual(new Array(7).fill(0));
  });

  it('surfaces a weekday bias as the standout residual on that weekday', () => {
    // D0 is a Thursday (weekday 4); bump every Thursday by 1000 over an otherwise flat series.
    const points: DailyPoint[] = Array.from({ length: 14 }, (_, i) => {
      const date = addUtcDays(D0, i);
      const isThursday = date.getUTCDay() === 4;
      return { date: toDateKey(date), revenueCents: 1000 + (isThursday ? 1000 : 0) };
    });
    const trend = fitLinearTrend(points);
    const seasonality = weekdaySeasonality(points, trend);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      if (weekday !== 4) expect(seasonality[4]).toBeGreaterThan(seasonality[weekday] + 400);
    }
  });
});

describe('buildSalesForecast', () => {
  it('falls back to a flat average when fewer than the minimum days carry revenue', () => {
    const points: DailyPoint[] = Array.from({ length: 14 }, (_, i) => ({
      date: toDateKey(addUtcDays(D0, i)),
      revenueCents: i === 0 ? 10000 : 0,
    }));
    const result = buildSalesForecast(points, 3, addUtcDays(D0, 14));
    expect(result.insufficientData).toBe(true);
    expect(result.method).toBe('insufficient_data_flat_average');
    expect(result.forecast).toHaveLength(3);
    expect(result.forecast.every((point) => point.revenue === result.forecast[0].revenue)).toBe(
      true,
    );
  });

  it('projects the trend and applies weekday seasonality forward', () => {
    const points: DailyPoint[] = Array.from({ length: 21 }, (_, i) => ({
      date: toDateKey(addUtcDays(D0, i)),
      revenueCents: 5000 + i * 100,
    }));
    const forecastStart = addUtcDays(D0, 21);
    const result = buildSalesForecast(points, 5, forecastStart);
    expect(result.insufficientData).toBe(false);
    expect(result.method).toBe('linear_trend_plus_day_of_week_seasonality');
    expect(result.trend.dailySlope).toBe('1.00');
    expect(result.forecast).toHaveLength(5);
    expect(result.forecast[0].date).toBe(toDateKey(forecastStart));
    expect(Number(result.forecast[0].revenue)).toBeGreaterThan(
      Number(result.history.at(-1)!.revenue),
    );
  });

  it('never forecasts negative revenue even with a steep downward trend', () => {
    const points: DailyPoint[] = Array.from({ length: 10 }, (_, i) => ({
      date: toDateKey(addUtcDays(D0, i)),
      revenueCents: Math.max(0, 100000 - i * 20000),
    }));
    const result = buildSalesForecast(points, 10, addUtcDays(D0, 10));
    expect(result.forecast.every((point) => Number(point.revenue) >= 0)).toBe(true);
  });
});

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
