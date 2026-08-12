/**
 * EventsModule: RabbitMQ event bus + transactional outbox (ADR-0007).
 *
 * Providers:
 * - `EventBusService` — AMQP publisher for the domain topic exchange.
 * - `OutboxService` — outbox writer (`append`) + background relay.
 *
 * The relay starts on application bootstrap and stops on shutdown.
 */
import { Global, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  providers: [
    {
      provide: EventBusService,
      useFactory: () => new EventBusService(process.env.RABBITMQ_URL),
    },
    OutboxService,
  ],
  exports: [EventBusService, OutboxService],
})
export class EventsModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    private readonly bus: EventBusService,
    private readonly outbox: OutboxService,
  ) {}

  onApplicationBootstrap(): void {
    // Non-blocking: a missing broker must not delay boot; the managed
    // connection keeps retrying and the outbox stays PENDING meanwhile.
    void this.bus.connect();
    this.outbox.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.outbox.stop();
    await this.bus.close();
  }
}
