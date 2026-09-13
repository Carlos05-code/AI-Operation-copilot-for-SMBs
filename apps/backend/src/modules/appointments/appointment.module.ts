/**
 * AppointmentsModule: booking CRUD, conflict detection, and reminders
 * (ROADMAP Phase 3, API_SPEC §11).
 *
 * `AppointmentReminderWorker` runs on the shared `ops-jobs` queue, the same
 * queue the invoice and inventory sweeps use. PrismaService, OutboxService,
 * and QueueService come from their global modules; every component is
 * fail-soft when infra is absent.
 */
import { Module } from '@nestjs/common';
import { AppointmentController } from './appointment.controller';
import { AppointmentReminderWorker } from './appointment.reminder.worker';
import { AppointmentService } from './appointment.service';

@Module({
  controllers: [AppointmentController],
  providers: [AppointmentService, AppointmentReminderWorker],
  exports: [AppointmentService],
})
export class AppointmentsModule {}
