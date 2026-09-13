/**
 * AppointmentService: booking CRUD, conflict detection, and the lifecycle
 * state machine (ROADMAP Phase 3 — appointment scheduling).
 *
 * `create`/`update` (when rescheduling) reject an overlapping booking for
 * the same `assigneeId` — only `SCHEDULED`/`CONFIRMED` appointments hold
 * their slot, so a cancelled or completed one never blocks a new booking.
 * Unassigned appointments (`assigneeId` unset) skip the conflict check
 * entirely. Status transitions are an explicit legal-transition map, same
 * shape as `InvoiceService`: an illegal move is `409 CONFLICT`, repeating
 * the current status is an idempotent no-op.
 */
import { Injectable, Optional } from '@nestjs/common';
import { AppointmentStatus, type Appointment, type Prisma } from '@prisma/client';
import { ApiError, HttpErrorCode } from '../../shared/errors/error-contract';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../events/outbox.service';
import {
  APPOINTMENT_MAX_DURATION_HOURS,
  APPOINTMENT_NOTES_MAX_LENGTH,
  APPOINTMENT_TITLE_MAX_LENGTH,
  EVENT_APPOINTMENT_CREATED,
  EVENT_APPOINTMENT_RESCHEDULED,
  EVENT_APPOINTMENT_STATUS_CHANGED,
} from './appointment.constants';

export interface CreateAppointmentInput {
  organizationId: string;
  customerId?: string | null;
  assigneeId?: string | null;
  title: string;
  notes?: string | null;
  startAt: Date;
  endAt: Date;
}

export interface UpdateAppointmentInput {
  title?: string;
  notes?: string | null;
  startAt?: Date;
  endAt?: Date;
}

export interface ListAppointmentsOptions {
  from?: Date;
  to?: Date;
  assigneeId?: string;
  status?: AppointmentStatus;
}

export interface AppointmentView {
  id: string;
  customerId: string | null;
  assigneeId: string | null;
  title: string;
  notes: string | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentListResult {
  items: AppointmentView[];
  total: number;
}

/** Slots actively held; a cancelled/completed/no-show booking never conflicts. */
const HOLDING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

/** Legal lifecycle transitions (source status → allowed target statuses). */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
  ],
  CONFIRMED: [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

@Injectable()
export class AppointmentService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  async create(input: CreateAppointmentInput): Promise<AppointmentView> {
    const prisma = this.requirePrisma();
    const title = requireTrimmed(input.title, 'title', APPOINTMENT_TITLE_MAX_LENGTH);
    const notes = normalizeNote(input.notes);
    const { startAt, endAt } = requireValidWindow(input.startAt, input.endAt);

    if (input.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!customer) {
        throw new ApiError({
          code: HttpErrorCode.NOT_FOUND,
          status: 404,
          message: 'Customer not found in this organization',
        });
      }
    }

    if (input.assigneeId) {
      await this.assertNoConflict(input.organizationId, input.assigneeId, startAt, endAt);
    }

    const appointment = await prisma.appointment.create({
      data: {
        organizationId: input.organizationId,
        customerId: input.customerId ?? null,
        assigneeId: input.assigneeId ?? null,
        title,
        notes,
        startAt,
        endAt,
      },
    });
    await this.emit(appointment, EVENT_APPOINTMENT_CREATED, {});
    return toView(appointment);
  }

  async list(
    organizationId: string,
    page = 1,
    limit = 20,
    opts: ListAppointmentsOptions = {},
  ): Promise<AppointmentListResult> {
    const prisma = this.requirePrisma();
    const where: Prisma.AppointmentWhereInput = {
      organizationId,
      ...(opts.assigneeId ? { assigneeId: opts.assigneeId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.from || opts.to
        ? {
            startAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        orderBy: { startAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.appointment.count({ where }),
    ]);
    return { items: rows.map(toView), total };
  }

  async get(organizationId: string, id: string): Promise<AppointmentView> {
    return toView(await this.load(organizationId, id));
  }

  /** Edits title/notes and, when start/end change, re-validates the window and re-checks conflicts. */
  async update(
    organizationId: string,
    id: string,
    patch: UpdateAppointmentInput,
  ): Promise<AppointmentView> {
    const prisma = this.requirePrisma();
    const existing = await this.load(organizationId, id);

    const data: Prisma.AppointmentUpdateInput = {};
    if (patch.title !== undefined) {
      data.title = requireTrimmed(patch.title, 'title', APPOINTMENT_TITLE_MAX_LENGTH);
    }
    if (patch.notes !== undefined) data.notes = normalizeNote(patch.notes);

    const reschedule = patch.startAt !== undefined || patch.endAt !== undefined;
    if (reschedule) {
      if (!HOLDING_STATUSES.includes(existing.status)) {
        throw new ApiError({
          code: HttpErrorCode.CONFLICT,
          status: 409,
          message: `Cannot reschedule a ${existing.status} appointment`,
        });
      }
      const { startAt, endAt } = requireValidWindow(
        patch.startAt ?? existing.startAt,
        patch.endAt ?? existing.endAt,
      );
      if (existing.assigneeId) {
        await this.assertNoConflict(organizationId, existing.assigneeId, startAt, endAt, id);
      }
      data.startAt = startAt;
      data.endAt = endAt;
    }

    if (Object.keys(data).length === 0) return toView(existing);
    const updated = await prisma.appointment.update({ where: { id: existing.id }, data });
    if (reschedule) await this.emit(updated, EVENT_APPOINTMENT_RESCHEDULED, {});
    return toView(updated);
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: AppointmentStatus,
  ): Promise<AppointmentView> {
    const prisma = this.requirePrisma();
    const existing = await this.load(organizationId, id);
    if (existing.status === status) return toView(existing);
    if (!TRANSITIONS[existing.status].includes(status)) {
      throw new ApiError({
        code: HttpErrorCode.CONFLICT,
        status: 409,
        message: `Cannot move appointment from ${existing.status} to ${status}`,
      });
    }
    const updated = await prisma.appointment.update({
      where: { id: existing.id },
      data: { status },
    });
    await this.emit(updated, EVENT_APPOINTMENT_STATUS_CHANGED, {
      from: existing.status,
      to: status,
    });
    return toView(updated);
  }

  private async assertNoConflict(
    organizationId: string,
    assigneeId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
  ): Promise<void> {
    const prisma = this.requirePrisma();
    const conflict = await prisma.appointment.findFirst({
      where: {
        organizationId,
        assigneeId,
        status: { in: HOLDING_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, startAt: true, endAt: true },
    });
    if (conflict) {
      throw new ApiError({
        code: HttpErrorCode.CONFLICT,
        status: 409,
        message: `Assignee already has an appointment from ${conflict.startAt.toISOString()} to ${conflict.endAt.toISOString()}`,
      });
    }
  }

  private async load(organizationId: string, id: string): Promise<Appointment> {
    const prisma = this.requirePrisma();
    const appointment = await prisma.appointment.findFirst({ where: { id, organizationId } });
    if (!appointment) {
      throw new ApiError({
        code: HttpErrorCode.NOT_FOUND,
        status: 404,
        message: 'Appointment not found in this organization',
      });
    }
    return appointment;
  }

  private async emit(
    appointment: Appointment,
    eventType: string,
    extra: Prisma.JsonObject,
  ): Promise<void> {
    try {
      await this.outbox?.append({
        aggregateType: 'appointment',
        aggregateId: appointment.id,
        eventType,
        payload: {
          id: appointment.id,
          organizationId: appointment.organizationId,
          status: appointment.status,
          ...extra,
        },
      });
    } catch {
      // Best-effort: the row is the system of record, an outbox miss is not fatal.
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

function requireTrimmed(value: string, field: string, maxLength: number): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'${field}' is required`,
    });
  }
  if (trimmed.length > maxLength) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `'${field}' exceeds ${maxLength} characters`,
    });
  }
  return trimmed;
}

function normalizeNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, APPOINTMENT_NOTES_MAX_LENGTH);
}

function requireValidWindow(startAt: Date, endAt: Date): { startAt: Date; endAt: Date } {
  if (startAt.getTime() >= endAt.getTime()) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: "'endAt' must be after 'startAt'",
    });
  }
  const hours = (endAt.getTime() - startAt.getTime()) / (60 * 60 * 1000);
  if (hours > APPOINTMENT_MAX_DURATION_HOURS) {
    throw new ApiError({
      code: HttpErrorCode.VALIDATION_ERROR,
      status: 400,
      message: `Appointment duration cannot exceed ${APPOINTMENT_MAX_DURATION_HOURS} hours`,
    });
  }
  return { startAt, endAt };
}

function toView(appointment: Appointment): AppointmentView {
  return {
    id: appointment.id,
    customerId: appointment.customerId,
    assigneeId: appointment.assigneeId,
    title: appointment.title,
    notes: appointment.notes,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt.toISOString(),
    status: appointment.status,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  };
}
