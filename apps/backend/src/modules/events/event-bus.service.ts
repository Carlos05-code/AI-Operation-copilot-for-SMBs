/**
 * EventBusService: publishing side of the RabbitMQ event bus (ADR-0007).
 *
 * Maintains a managed AMQP connection and a single confirmed channel bound to
 * the topic exchange `copilot.domain.events`. Events are published with the
 * event type as the routing key (`invoice.created`, `knowledge.indexed`, ...)
 * so consumers can bind topic patterns. Fail-soft: when `RABBITMQ_URL` is not
 * set the bus never connects and `publish` returns false, leaving the outbox
 * relay to retry later.
 */
import { Injectable, Logger } from '@nestjs/common';
import amqp, { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { DOMAIN_EVENTS_EXCHANGE, DOMAIN_EVENTS_EXCHANGE_TYPE } from './events.constants';

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;
  private connected = false;

  constructor(private readonly url?: string) {}

  get isConnected(): boolean {
    return this.connected;
  }

  /** Opens the managed connection and asserts the domain exchange. */
  async connect(): Promise<void> {
    if (!this.url || this.connected) return;
    this.connection = amqp.connect([this.url], {
      reconnectTimeInSeconds: 5,
      connectionOptions: { timeout: 3000 },
    });
    this.connection.on('connect', () => {
      this.connected = true;
      this.logger.log('connected to RabbitMQ');
    });
    this.connection.on('disconnect', (error) => {
      this.connected = false;
      const message = (error as { err?: Error }).err?.message ?? 'unknown';
      this.logger.warn(`disconnected from RabbitMQ: ${message}`);
    });
    try {
      this.channel = this.connection.createChannel({ json: false });
      await this.channel.waitForConnect();
      await this.channel.assertExchange(DOMAIN_EVENTS_EXCHANGE, DOMAIN_EVENTS_EXCHANGE_TYPE, {
        durable: true,
      });
    } catch (error) {
      // Broker unreachable: keep the managed connection retrying in the
      // background and leave the outbox PENDING for when it returns.
      this.logger.warn(`RabbitMQ unavailable at boot: ${(error as Error)?.message}`);
    }
  }

  /**
   * Publishes a domain event with `eventType` as the routing key.
   * Resolves false when the bus is not available (message stays in the outbox).
   */
  async publish(eventType: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.channel || !this.connected) return false;
    try {
      await this.channel.publish(
        DOMAIN_EVENTS_EXCHANGE,
        eventType,
        Buffer.from(JSON.stringify(payload), 'utf8'),
        {
          contentType: 'application/json',
          persistent: true,
          timestamp: Math.floor(Date.now() / 1000),
        },
      );
      return true;
    } catch (error) {
      this.logger.error(`publish failed for ${eventType}: ${(error as Error)?.message}`);
      return false;
    }
  }

  /** Closes the AMQP connection (idempotent). */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = undefined;
      this.channel = undefined;
      this.connected = false;
    }
  }
}
