/**
 * Unit tests — SalesForecastService (query bounds, revenue bucketing, 503).
 */
import type { PrismaService } from '../database/prisma.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { SalesForecastService } from './sales-forecast.service';

function decimal(value: string): { toFixed: () => string } {
  return { toFixed: () => value };
}

function harness() {
  const prisma = { invoice: { findMany: jest.fn().mockResolvedValue([]) } };
  const service = new SalesForecastService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('SalesForecastService.forecast', () => {
  it('queries PAID invoices in [today - lookbackDays, today) and bucket-sums them', async () => {
    const { service, prisma } = harness();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateKey = yesterday.toISOString().slice(0, 10);
    prisma.invoice.findMany.mockResolvedValue([
      { createdAt: new Date(`${dateKey}T09:00:00Z`), total: decimal('100.00') },
      { createdAt: new Date(`${dateKey}T18:00:00Z`), total: decimal('50.00') },
    ]);

    const result = await service.forecast('org-1', 14, 7);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', status: 'PAID' }),
      }),
    );
    expect(result.lookbackDays).toBe(14);
    expect(result.horizonDays).toBe(7);
    expect(result.history).toHaveLength(14);
    expect(result.forecast).toHaveLength(7);
    const day = result.history.find((point) => point.date === dateKey);
    expect(day?.revenue).toBe('150.00');
  });

  it('clamps out-of-range lookback/horizon to the configured bounds', async () => {
    const { service } = harness();
    const tooSmall = await service.forecast('org-1', 1, 0);
    expect(tooSmall.lookbackDays).toBe(14);
    expect(tooSmall.horizonDays).toBe(1);

    const tooLarge = await service.forecast('org-1', 10_000, 10_000);
    expect(tooLarge.lookbackDays).toBe(180);
    expect(tooLarge.horizonDays).toBe(60);
  });

  it('defaults lookback/horizon when omitted', async () => {
    const { service } = harness();
    const result = await service.forecast('org-1');
    expect(result.lookbackDays).toBe(90);
    expect(result.horizonDays).toBe(14);
  });

  it('flags insufficient data with no paid-invoice history', async () => {
    const { service } = harness();
    const result = await service.forecast('org-1', 14, 3);
    expect(result.insufficientData).toBe(true);
    expect(result.method).toBe('insufficient_data_flat_average');
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new SalesForecastService(undefined);
    await expect(service.forecast('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});
