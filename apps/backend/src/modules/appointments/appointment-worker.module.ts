/**
 * AppointmentsWorkerModule: the `AppointmentReminderWorker` half of
 * `appointment.module.ts`, split out so `worker-app.module.ts` never
 * instantiates `AppointmentController` (DEVOPS_SPEC §3). Runs on the shared
 * `ops-jobs` queue, the same queue the invoice and inventory sweeps use.
 */
import { Module } from '@nestjs/common';
import { AppointmentReminderWorker } from './appointment.reminder.worker';

@Module({
  providers: [AppointmentReminderWorker],
})
export class AppointmentsWorkerModule {}
