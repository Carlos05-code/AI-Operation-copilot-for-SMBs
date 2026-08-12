import { OutboxService } from './outbox.service';

function prismaMock(statuses: string[]) {
  return {
    outboxEvent: {
      create: jest.fn().mockResolvedValue({ id: 'e1' }),
      findMany: jest.fn().mockResolvedValue(
        statuses.map((status, i) => ({
          id: `ev-${i}`,
          aggregateType: 'invoice',
          aggregateId: `inv-${i}`,
          eventType: 'invoice.created',
          payload: { number: i },
          status,
        })),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

const bus = {
  isConnected: true,
  publish: jest.fn<Promise<boolean>, [string, Record<string, unknown>]>(),
};

describe('OutboxService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is inert when either the database or the bus is missing', async () => {
    const service = new OutboxService(undefined, undefined);
    expect(service.isRunning).toBe(false);
    await expect(service.relayOnce()).resolves.toBe(0);
    await service.append({ aggregateType: 'a', aggregateId: '1', eventType: 'x', payload: {} });
  });

  it('records a domain event via append within the caller transaction', async () => {
    const prisma = prismaMock([]);
    const service = new OutboxService(prisma as never, bus as never);
    await service.append({
      aggregateType: 'invoice',
      aggregateId: 'inv-1',
      eventType: 'invoice.created',
      payload: { number: 1 },
    });
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        aggregateType: 'invoice',
        aggregateId: 'inv-1',
        eventType: 'invoice.created',
        payload: { number: 1 },
        status: 'PENDING',
      },
    });
  });

  it('publishes PENDING events and marks them PROCESSED with a timestamp', async () => {
    const prisma = prismaMock(['PENDING', 'PENDING']);
    bus.publish.mockResolvedValue(true);
    const service = new OutboxService(prisma as never, bus as never);

    await expect(service.relayOnce()).resolves.toBe(2);
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(bus.publish).toHaveBeenCalledWith('invoice.created', {
      aggregate: { type: 'invoice', id: 'inv-0' },
      eventType: 'invoice.created',
      payload: { number: 0 },
    });
    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(2);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'ev-0' },
      data: { status: 'PROCESSED', processedAt: expect.any(Date) },
    });
  });

  it('marks FAILED when the bus rejects the publish', async () => {
    const prisma = prismaMock(['PENDING']);
    bus.publish.mockResolvedValue(false);
    const service = new OutboxService(prisma as never, bus as never);

    await expect(service.relayOnce()).resolves.toBe(0);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'ev-0' },
      data: { status: 'FAILED' },
    });
  });

  it('does not relay while the bus is disconnected', async () => {
    const prisma = prismaMock(['PENDING']);
    const disconnected = { ...bus, isConnected: false };
    const service = new OutboxService(prisma as never, disconnected as never);
    await expect(service.relayOnce()).resolves.toBe(0);
    expect(prisma.outboxEvent.findMany).not.toHaveBeenCalled();
  });

  it('does not start the relay when one dependency is missing; stop clears the timer', () => {
    const noBus = new OutboxService(prismaMock([]) as never, undefined);
    noBus.start();
    expect(noBus.isRunning).toBe(false);

    const noDb = new OutboxService(undefined, bus as never);
    noDb.start();
    expect(noDb.isRunning).toBe(false);

    const running = new OutboxService(prismaMock([]) as never, bus as never);
    running.start();
    expect(running.isRunning).toBe(true);
    running.stop();
    expect(running.isRunning).toBe(false);
  });

  it('queries only PENDING events, oldest first, bounded by the batch size', async () => {
    const prisma = prismaMock(['PENDING']);
    bus.publish.mockResolvedValue(true);
    const service = new OutboxService(prisma as never, bus as never);
    await service.relayOnce();
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  });
});
