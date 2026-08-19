/**
 * TaskService: org-scoped task surface + plan scheduling (ROADMAP Phase 3,
 * API_SPEC §11.11).
 *
 * `POST /tasks/plan` enqueues a `task.plan` job on the shared `ai-jobs` queue
 * (fire-and-forget, fail-soft — a Redis outage never fails the request).
 * Reads and status updates are org-scoped; foreign tasks surface as 404.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Task, TaskStatus } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { QueueService } from '../queue/queue.service';
import { JOB_TASK_PLAN } from './task.constants';

export interface TaskListResult {
  items: Array<{
    id: string;
    title: string;
    description: string | null;
    priority: Task['priority'];
    status: Task['status'];
    dueDate: Date | null;
    assigneeId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  total: number;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly queue?: QueueService,
  ) {}

  async list(
    organizationId: string,
    page = 1,
    limit = 20,
    status?: TaskStatus,
  ): Promise<TaskListResult> {
    const prisma = this.requirePrisma();
    const where = {
      organizationId,
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ priority: 'desc' as const }, { createdAt: 'asc' as const }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          priority: true,
          status: true,
          dueDate: true,
          assigneeId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.task.count({ where }),
    ]);
    return { items, total };
  }

  async get(organizationId: string, taskId: string): Promise<Task> {
    const prisma = this.requirePrisma();
    const task = await prisma.task.findFirst({ where: { id: taskId, organizationId } });
    if (!task) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Task not found',
      });
    }
    return task;
  }

  async updateStatus(organizationId: string, taskId: string, status: TaskStatus): Promise<Task> {
    const prisma = this.requirePrisma();
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true },
    });
    if (!task) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Task not found',
      });
    }
    return prisma.task.update({ where: { id: taskId }, data: { status } });
  }

  /** Schedules the AI planning job for the org (fire-and-forget). */
  async requestPlan(organizationId: string): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.enqueue('ai-jobs', JOB_TASK_PLAN, { organizationId });
    } catch (error) {
      this.logger.warn(`task plan job enqueue skipped: ${(error as Error)?.message}`);
    }
  }

  private requirePrisma(): PrismaService {
    if (!this.prisma) {
      throw new ApiError({
        code: HttpErrorCode.INTERNAL_ERROR,
        status: 503,
        message: 'Database is not configured',
      });
    }
    return this.prisma;
  }
}
