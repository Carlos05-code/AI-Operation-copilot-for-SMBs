/**
 * Unit tests — TaskService (org-scoped task surface, plan scheduling).
 */
import type { PrismaService } from '../database/prisma.service';
import type { QueueService } from '../queue/queue.service';
import { HttpErrorCode } from '../../shared/errors/error-contract';
import { TaskService } from './task.service';

function harness(): {
  service: TaskService;
  prisma: {
    task: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };
  queue: { enqueue: jest.Mock };
} {
  const prisma = {
    task: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const queue = { enqueue: jest.fn() };
  const service = new TaskService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
  );
  return { service, prisma, queue };
}

describe('TaskService', () => {
  it('lists the org tasks with priority order and optional status filter', async () => {
    const { service, prisma } = harness();
    prisma.task.findMany.mockResolvedValue([{ id: 'task-1', title: 'Follow up invoice' }]);
    prisma.task.count.mockResolvedValue(1);
    const result = await service.list('org-1', 1, 20, 'TODO');
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', status: 'TODO' },
        skip: 0,
        take: 20,
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('fetches an org task and 404s foreign ones', async () => {
    const { service, prisma } = harness();
    prisma.task.findFirst.mockResolvedValue({ id: 'task-1' });
    await expect(service.get('org-1', 'task-1')).resolves.toMatchObject({ id: 'task-1' });
    prisma.task.findFirst.mockResolvedValue(null);
    await expect(service.get('org-2', 'task-1')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
      status: 404,
    });
  });

  it('updates a task status only when the task belongs to the org', async () => {
    const { service, prisma } = harness();
    prisma.task.findFirst.mockResolvedValue({ id: 'task-1' });
    prisma.task.update.mockResolvedValue({ id: 'task-1', status: 'DONE' });
    await expect(service.updateStatus('org-1', 'task-1', 'DONE')).resolves.toMatchObject({
      status: 'DONE',
    });
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'DONE' },
    });

    prisma.task.findFirst.mockResolvedValue(null);
    await expect(service.updateStatus('org-2', 'task-1', 'DONE')).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
    });
    expect(prisma.task.update).toHaveBeenCalledTimes(1);
  });

  it('schedules the planning job and swallows enqueue failures', async () => {
    const { service, queue } = harness();
    await service.requestPlan('org-1');
    expect(queue.enqueue).toHaveBeenCalledWith('ai-jobs', 'task.plan', { organizationId: 'org-1' });
    queue.enqueue.mockRejectedValue(new Error('redis down'));
    await expect(service.requestPlan('org-1')).resolves.toBeUndefined();
  });

  it('fails with a contract error when the database is not configured', async () => {
    const service = new TaskService(undefined, undefined);
    await expect(service.list('org-1')).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_ERROR,
      status: 503,
    });
  });
});
