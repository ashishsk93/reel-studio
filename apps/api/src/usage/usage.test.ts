import { describe, expect, it } from 'vitest';
import { dailySeries } from './usage.service';

describe('dailySeries', () => {
  it('fills the days without calls with zeros', () => {
    const days = new Map([
      ['2026-10-01', { date: '2026-10-01', calls: 2, costUsd: 0.02 }],
      ['2026-10-03', { date: '2026-10-03', calls: 1, costUsd: 0.01 }],
    ]);
    const series = dailySeries(days, undefined, new Date('2026-10-04T12:00:00Z'));
    expect(series.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(series[1]).toEqual({ date: '2026-10-02', calls: 0, costUsd: 0 });
  });

  it('keeps at most the last 60 days', () => {
    const series = dailySeries(new Map(), new Date('2026-01-01T00:00:00Z'), new Date('2026-10-04T00:00:00Z'));
    expect(series).toHaveLength(60);
    expect(series[series.length - 1].date).toBe('2026-10-04');
  });
});
