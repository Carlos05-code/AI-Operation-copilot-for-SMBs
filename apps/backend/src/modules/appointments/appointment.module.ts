/**
 * AppointmentsModule: booking CRUD + conflict detection (ROADMAP Phase 3,
 * API_SPEC §11). HTTP-only — the reminder sweep worker lives in
 * `appointment-worker.module.ts` (DEVOPS_SPEC §3). PrismaService,
 * OutboxService, and QueueService come from their global modules; every
 * component is fail-soft when infra is absent.
 */
import { Module } from '@nestjs/common';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';

@Module({
  controllers: [AppointmentController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentsModule {}
