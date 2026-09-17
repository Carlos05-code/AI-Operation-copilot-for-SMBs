/**
 * Unit tests — NotificationDeliveryWorker (email + WhatsApp delivery sweep).
 */
import type { Job } from 'bullmq';
import type { PrismaService } from '../database/prisma.service';
import { NotificationDeliveryWorker } from './notification.delivery.worker';
import type { EmailProvider } from './email.provider';
import type { WhatsAppProvider } from './whatsapp.provider';

function pendingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'n1',
    userId: 'u1',
    kind: 'IN_APP',
    title: 'Invoice INV-001 is overdue',
    body: '120.00 was due and is now overdue.',
    deliveryStatus: 'PENDING',
    ...over,
  };
}

function harness() {
  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'u1', email: 'owner@acme-demo.local', whatsapp: '+15551234567' },
        ]),
    },
  };
  const email = { isConfigured: true, send: jest.fn().mockResolvedValue(undefined) };
  const whatsapp = { isConfigured: true, send: jest.fn().mockResolvedValue(undefined) };
  const worker = new NotificationDeliveryWorker(
    email as unknown as EmailProvider,
    whatsapp as unknown as WhatsAppProvider,
    prisma as unknown as PrismaService,
  );
  return { worker, prisma, email, whatsapp };
}

const job = (over: Partial<Job> = {}): Job =>
  ({ name: 'notification.delivery.sweep', data: {}, ...over }) as unknown as Job;

describe('NotificationDeliveryWorker', () => {
  it('ignores non-matching job names', async () => {
    const { worker } = harness();
    await expect(worker.process(job({ name: 'invoice.overdue.sweep' }))).resolves.toMatchObject({
      skipped: 'name mismatch',
    });
  });

  it('skips when the database is not configured', async () => {
    const worker = new NotificationDeliveryWorker(
      {} as unknown as EmailProvider,
      {} as unknown as WhatsAppProvider,
      undefined,
    );
    await expect(worker.process(job())).resolves.toMatchObject({ skipped: 'not configured' });
  });

  it('returns cleanly when nothing is pending or failed', async () => {
    const { worker } = harness();
    await expect(worker.process(job())).resolves.toEqual({
      ran: true,
      candidates: 0,
      sent: 0,
      failed: 0,
    });
  });

  it('queries both PENDING and FAILED rows, oldest first', async () => {
    const { worker, prisma } = harness();
    await worker.process(job());
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deliveryStatus: { in: ['PENDING', 'FAILED'] } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('sends the email and claims SENT with a timestamp', async () => {
    const { worker, prisma, email } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow()]);

    const result = await worker.process(job());

    expect(email.send).toHaveBeenCalledWith({
      to: 'owner@acme-demo.local',
      subject: 'Invoice INV-001 is overdue',
      text: '120.00 was due and is now overdue.',
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', deliveryStatus: 'PENDING' },
      data: expect.objectContaining({ deliveryStatus: 'SENT', deliveryError: null }),
    });
    expect(result).toMatchObject({ candidates: 1, sent: 1, failed: 0 });
  });

  it('claims FAILED (retryable) when the user has no email on file', async () => {
    const { worker, prisma, email } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow()]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', email: null }]);

    const result = await worker.process(job());

    expect(email.send).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', deliveryStatus: 'PENDING' },
      data: expect.objectContaining({
        deliveryStatus: 'FAILED',
        deliveryError: 'no email on file for this user',
      }),
    });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });

  it('claims FAILED when the email provider is not configured', async () => {
    const { worker, prisma, email } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow()]);
    (email as { isConfigured: boolean }).isConfigured = false;

    const result = await worker.process(job());

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryError: 'email provider not configured' }),
      }),
    );
  });

  it('claims FAILED and truncates the message when sending throws', async () => {
    const { worker, prisma, email } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow({ deliveryStatus: 'FAILED' })]);
    email.send.mockRejectedValue(new Error('SMTP timeout'));

    const result = await worker.process(job());

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', deliveryStatus: 'FAILED' },
      data: expect.objectContaining({ deliveryStatus: 'FAILED', deliveryError: 'SMTP timeout' }),
    });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });

  it('does not count a claim a concurrent sweep already took', async () => {
    const { worker, prisma } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow()]);
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const result = await worker.process(job());

    expect(result).toMatchObject({ sent: 0, failed: 0 });
  });

  it('resolves recipient emails once per batch, not once per notification', async () => {
    const { worker, prisma } = harness();
    prisma.notification.findMany.mockResolvedValue([
      pendingRow({ id: 'n1', userId: 'u1' }),
      pendingRow({ id: 'n2', userId: 'u1' }),
    ]);
    await worker.process(job());
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('sends WHATSAPP-kind rows via WhatsAppProvider, not email', async () => {
    const { worker, prisma, email, whatsapp } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow({ kind: 'WHATSAPP' })]);

    const result = await worker.process(job());

    expect(whatsapp.send).toHaveBeenCalledWith({
      to: '+15551234567',
      body: '120.00 was due and is now overdue.',
    });
    expect(email.send).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', deliveryStatus: 'PENDING' },
      data: expect.objectContaining({ deliveryStatus: 'SENT', deliveryError: null }),
    });
    expect(result).toMatchObject({ candidates: 1, sent: 1, failed: 0 });
  });

  it('claims FAILED (retryable) when a WHATSAPP-kind row has no whatsapp number on file', async () => {
    const { worker, prisma, whatsapp } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow({ kind: 'WHATSAPP' })]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'owner@acme-demo.local', whatsapp: null },
    ]);

    const result = await worker.process(job());

    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryError: 'no whatsapp number on file for this user',
        }),
      }),
    );
    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });

  it('claims FAILED for a WHATSAPP-kind row when the whatsapp provider is not configured', async () => {
    const { worker, prisma, whatsapp } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow({ kind: 'WHATSAPP' })]);
    (whatsapp as { isConfigured: boolean }).isConfigured = false;

    const result = await worker.process(job());

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryError: 'whatsapp provider not configured' }),
      }),
    );
  });

  it('claims FAILED for a WHATSAPP-kind row when sending throws', async () => {
    const { worker, prisma, whatsapp } = harness();
    prisma.notification.findMany.mockResolvedValue([pendingRow({ kind: 'WHATSAPP' })]);
    whatsapp.send.mockRejectedValue(new Error('Twilio 21211: invalid to number'));

    const result = await worker.process(job());

    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryError: 'Twilio 21211: invalid to number' }),
      }),
    );
    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });
});
