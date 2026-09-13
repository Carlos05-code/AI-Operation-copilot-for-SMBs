/**
 * Unit tests — InventoryService (stock ledger, on-hand, reorder alerts).
 */
import type { OutboxService } from '../events/outbox.service';
import type { PrismaService } from '../database/prisma.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { InventoryService, type ReorderAlertProduct } from './inventory.service';

function movementRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'mv-1',
    productId: 'prod-1',
    type: 'IN',
    quantity: 10,
    note: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    ...over,
  };
}

function product(over: Partial<ReorderAlertProduct> = {}): ReorderAlertProduct {
  return {
    id: 'prod-1',
    name: 'Espresso Beans 1kg',
    sku: 'COF-001',
    reorderPoint: 20,
    belowReorderPoint: false,
    active: true,
    ...over,
  };
}

function harness() {
  const prisma = {
    inventoryMovement: {
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(movementRow()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    product: {
      findFirst: jest.fn().mockResolvedValue(product()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    member: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]),
    },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new InventoryService(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { service, prisma, outbox };
}

describe('InventoryService.onHandFor', () => {
  it('skips the query and returns an empty map for no ids', async () => {
    const { service, prisma } = harness();
    const map = await service.onHandFor([]);
    expect(map.size).toBe(0);
    expect(prisma.inventoryMovement.groupBy).not.toHaveBeenCalled();
  });

  it('computes on-hand from grouped movement sums', async () => {
    const { service, prisma } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([
      { productId: 'prod-1', type: 'IN', _sum: { quantity: 30 } },
      { productId: 'prod-1', type: 'OUT', _sum: { quantity: 5 } },
    ]);
    const map = await service.onHandFor(['prod-1']);
    expect(map.get('prod-1')).toBe(25);
    expect(prisma.inventoryMovement.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productId: { in: ['prod-1'] } } }),
    );
  });
});

describe('InventoryService.getStock', () => {
  it('404s a foreign or unknown product', async () => {
    const { service, prisma } = harness();
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.getStock('org-1', 'prod-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });

  it('returns the computed on-hand snapshot', async () => {
    const { service, prisma } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([
      { productId: 'prod-1', type: 'IN', _sum: { quantity: 12 } },
    ]);
    await expect(service.getStock('org-1', 'prod-1')).resolves.toMatchObject({
      productId: 'prod-1',
      onHand: 12,
      reorderPoint: 20,
      belowReorderPoint: false,
    });
  });
});

describe('InventoryService.recordMovement', () => {
  it('creates an IN movement, emits the outbox event, and re-evaluates the reorder state', async () => {
    const { service, prisma, outbox } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([
      { productId: 'prod-1', type: 'IN', _sum: { quantity: 30 } },
    ]);

    const view = await service.recordMovement({
      organizationId: 'org-1',
      productId: 'prod-1',
      type: 'IN',
      quantity: 10,
      note: '  received  ',
    });

    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith({
      data: { productId: 'prod-1', type: 'IN', quantity: 10, note: 'received' },
    });
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'inventory.movement_recorded' }),
    );
    expect(view.type).toBe('IN');
    // on-hand (30) >= reorderPoint (20): not low, was not flagged -> no state change.
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('flips belowReorderPoint and notifies when a movement pushes stock under the reorder point', async () => {
    const { service, prisma, outbox } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([
      { productId: 'prod-1', type: 'IN', _sum: { quantity: 5 } },
    ]);

    await service.recordMovement({
      organizationId: 'org-1',
      productId: 'prod-1',
      type: 'OUT',
      quantity: 3,
    });

    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'prod-1', belowReorderPoint: false },
      data: { belowReorderPoint: true },
    });
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ userId: 'u1', organizationId: 'org-1', kind: 'IN_APP' }),
          expect.objectContaining({ userId: 'u2' }),
        ],
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'inventory.reorder_alert' }),
    );
  });

  it('rejects zero/negative quantity for IN and OUT but allows a negative ADJUST', async () => {
    const { service } = harness();
    await expect(
      service.recordMovement({
        organizationId: 'org-1',
        productId: 'prod-1',
        type: 'IN',
        quantity: 0,
      }),
    ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR, status: 400 });
    await expect(
      service.recordMovement({
        organizationId: 'org-1',
        productId: 'prod-1',
        type: 'OUT',
        quantity: -1,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.recordMovement({
        organizationId: 'org-1',
        productId: 'prod-1',
        type: 'ADJUST',
        quantity: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });

    const { service: service2, prisma: prisma2 } = harness();
    prisma2.inventoryMovement.create.mockResolvedValue(
      movementRow({ type: 'ADJUST', quantity: -4 }),
    );
    await expect(
      service2.recordMovement({
        organizationId: 'org-1',
        productId: 'prod-1',
        type: 'ADJUST',
        quantity: -4,
      }),
    ).resolves.toMatchObject({ quantity: -4 });
  });

  it('404s when the product is not in the org, without writing a movement', async () => {
    const { service, prisma } = harness();
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(
      service.recordMovement({
        organizationId: 'org-1',
        productId: 'ghost',
        type: 'IN',
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: HttpErrorCode.NOT_FOUND, status: 404 });
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });
});

describe('InventoryService.listMovements', () => {
  it('404s a foreign product and paginates otherwise', async () => {
    const { service, prisma } = harness();
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.listMovements('org-1', 'prod-1')).rejects.toMatchObject({ status: 404 });

    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
    prisma.inventoryMovement.findMany.mockResolvedValue([movementRow()]);
    prisma.inventoryMovement.count.mockResolvedValue(1);
    const result = await service.listMovements('org-1', 'prod-1', 1, 20);
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('mv-1');
  });
});

describe('InventoryService.evaluateReorderAlert', () => {
  it('is a no-op when stock is fine and no flag is set', async () => {
    const { service, prisma } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([
      { productId: 'prod-1', type: 'IN', _sum: { quantity: 50 } },
    ]);
    const outcome = await service.evaluateReorderAlert('org-1', product());
    expect(outcome).toBe('unchanged');
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('does not double-notify when a concurrent evaluation already claimed the flip', async () => {
    const { service, prisma } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([]); // onHand 0 < reorderPoint 20
    prisma.product.updateMany.mockResolvedValue({ count: 0 });
    const outcome = await service.evaluateReorderAlert('org-1', product());
    expect(outcome).toBe('unchanged');
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('clears the flag and emits a restocked event once stock recovers (no notification)', async () => {
    const { service, prisma, outbox } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([
      { productId: 'prod-1', type: 'IN', _sum: { quantity: 25 } },
    ]);
    const outcome = await service.evaluateReorderAlert(
      'org-1',
      product({ belowReorderPoint: true }),
    );
    expect(outcome).toBe('restocked');
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'prod-1', belowReorderPoint: true },
      data: { belowReorderPoint: false },
    });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'inventory.restocked' }),
    );
  });

  it('never alerts an inactive product and clears a stale flag instead', async () => {
    const { service, prisma } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([]); // onHand 0, would be "low" if active
    const outcome = await service.evaluateReorderAlert(
      'org-1',
      product({ active: false, belowReorderPoint: true }),
    );
    expect(outcome).toBe('restocked');
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('resolves each org recipients once when a cache is shared across calls', async () => {
    const { service, prisma } = harness();
    prisma.inventoryMovement.groupBy.mockResolvedValue([]);
    const cache = new Map<string, string[]>();
    await service.evaluateReorderAlert('org-1', product({ id: 'p1' }), cache);
    await service.evaluateReorderAlert('org-1', product({ id: 'p2' }), cache);
    expect(prisma.member.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new InventoryService(undefined, undefined);
    await expect(service.evaluateReorderAlert('org-1', product())).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});
