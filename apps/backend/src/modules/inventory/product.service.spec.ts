/**
 * Unit tests — ProductService (catalog CRUD, computed on-hand).
 */
import type { PrismaService } from '../database/prisma.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import type { InventoryService } from './inventory.service';
import { ProductService } from './product.service';

function decimal(value: string): { toFixed: () => string } {
  return { toFixed: () => value };
}

function productRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prod-1',
    organizationId: 'org-1',
    name: 'Espresso Beans 1kg',
    sku: 'COF-001',
    price: decimal('18.50'),
    cost: decimal('9.20'),
    reorderPoint: 20,
    belowReorderPoint: false,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function harness() {
  const prisma = {
    product: {
      create: jest.fn().mockResolvedValue(productRow()),
      findMany: jest.fn().mockResolvedValue([productRow()]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(productRow()),
      update: jest.fn().mockResolvedValue(productRow()),
    },
  };
  const inventory = {
    onHandFor: jest.fn().mockResolvedValue(new Map([['prod-1', 12]])),
    evaluateReorderAlert: jest.fn().mockResolvedValue('unchanged'),
  };
  const service = new ProductService(
    prisma as unknown as PrismaService,
    inventory as unknown as InventoryService,
  );
  return { service, prisma, inventory };
}

describe('ProductService.create', () => {
  it('creates a product and returns it with onHand 0', async () => {
    const { service, prisma } = harness();
    const view = await service.create({
      organizationId: 'org-1',
      name: '  Espresso Beans 1kg  ',
      sku: '  COF-001  ',
      price: 18.5,
      cost: 9.2,
      reorderPoint: 20,
    });
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        name: 'Espresso Beans 1kg',
        sku: 'COF-001',
        price: 18.5,
        cost: 9.2,
        reorderPoint: 20,
        active: true,
      },
    });
    expect(view).toMatchObject({ onHand: 0, price: '18.50', cost: '9.20' });
  });

  it('409s a duplicate sku (P2002) instead of a raw db error', async () => {
    const { service, prisma } = harness();
    prisma.product.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(
      service.create({ organizationId: 'org-1', name: 'x', sku: 'DUP-1', price: 1 }),
    ).rejects.toMatchObject({ code: HttpErrorCode.CONFLICT, status: 409 });
  });

  it('400s invalid name, price, and reorderPoint', async () => {
    const { service } = harness();
    await expect(
      service.create({ organizationId: 'org-1', name: '  ', sku: 'X-1', price: 1 }),
    ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR, status: 400 });
    await expect(
      service.create({ organizationId: 'org-1', name: 'x', sku: 'X-1', price: -1 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create({
        organizationId: 'org-1',
        name: 'x',
        sku: 'X-1',
        price: 1,
        reorderPoint: 1.5,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns the 503 contract error with no database', async () => {
    const service = new ProductService(undefined, undefined);
    await expect(
      service.create({ organizationId: 'org-1', name: 'x', sku: 'X-1', price: 1 }),
    ).rejects.toMatchObject({ code: HttpErrorCode.INTERNAL_ERROR, status: 503 });
  });
});

describe('ProductService.list/get', () => {
  it('lists org products with batched on-hand and passes through filters', async () => {
    const { service, prisma, inventory } = harness();
    const result = await service.list('org-1', 1, 20, { active: true, lowStock: true });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', active: true, belowReorderPoint: true },
      }),
    );
    expect(inventory.onHandFor).toHaveBeenCalledWith(['prod-1']);
    expect(result.items[0].onHand).toBe(12);
    expect(result.total).toBe(1);
  });

  it('404s an unknown or foreign product', async () => {
    const { service, prisma } = harness();
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'prod-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });
});

describe('ProductService.update', () => {
  it('patches allowed fields and re-evaluates the reorder state when reorderPoint changes', async () => {
    const { service, prisma, inventory } = harness();
    prisma.product.update.mockResolvedValue(productRow({ reorderPoint: 40 }));

    await service.update('org-1', 'prod-1', { reorderPoint: 40 });

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { reorderPoint: 40 },
    });
    expect(inventory.evaluateReorderAlert).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ id: 'prod-1', reorderPoint: 40 }),
    );
  });

  it('skips both the write and the re-evaluation when the patch is empty', async () => {
    const { service, prisma, inventory } = harness();
    await service.update('org-1', 'prod-1', {});
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(inventory.evaluateReorderAlert).not.toHaveBeenCalled();
  });

  it('404s updating a foreign product', async () => {
    const { service, prisma } = harness();
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.update('org-2', 'prod-1', { name: 'x' })).rejects.toMatchObject({
      status: 404,
    });
  });
});
