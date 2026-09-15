/**
 * Application-level metrics (DEVOPS_SPEC §8 default alerts: API p95 latency,
 * error rate, queue backlog).
 *
 * Reads the global `Meter` registered by `setupOpenTelemetry()` — metrics
 * always work (the Prometheus reader is registered unconditionally), even
 * when `setupOpenTelemetry()` hasn't run yet (e.g. under test): `@opentelemetry/api`
 * falls back to a no-op meter that safely swallows every call.
 */
import { Injectable } from '@nestjs/common';
import { metrics, type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';

const METER_NAME = 'smb-copilot-api';

/**
 * Seconds-scale buckets, fine enough below DEVOPS_SPEC §8's 800 ms p95 alert
 * threshold to actually resolve a percentile there. The SDK's own defaults
 * are tuned for millisecond-unit histograms and would collapse every real
 * request into the first bucket for a seconds-unit one like this.
 */
const HTTP_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5, 10,
];

@Injectable()
export class AppMetricsService {
  private readonly requestDuration: Histogram;
  private readonly requestsTotal: Counter;
  private queueGauge?: ObservableGauge;

  constructor() {
    const meter = metrics.getMeter(METER_NAME);
    this.requestDuration = meter.createHistogram('http.request.duration', {
      description: 'HTTP request duration',
      unit: 's',
      advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS_SECONDS },
    });
    this.requestsTotal = meter.createCounter('http.requests.total', {
      description: 'HTTP requests handled, labeled by route and status',
    });
  }

  /** Records one completed HTTP request (DEVOPS_SPEC §8: p95 latency, error rate). */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const attributes = { method, route, status_code: String(statusCode) };
    this.requestDuration.record(durationSeconds, attributes);
    this.requestsTotal.add(1, attributes);
  }

  /**
   * Registers a queue-depth gauge sampled on every scrape (DEVOPS_SPEC §8:
   * queue backlog). `sample` must be safe to call with no infra configured —
   * BullMQ's own client already no-ops without Redis.
   */
  registerQueueDepth(sample: () => Promise<Array<{ queue: string; waiting: number }>>): void {
    if (this.queueGauge) return;
    const meter = metrics.getMeter(METER_NAME);
    this.queueGauge = meter.createObservableGauge('queue.jobs.waiting', {
      description: 'Jobs waiting per BullMQ queue',
    });
    this.queueGauge.addCallback(async (observableResult) => {
      const depths = await sample();
      for (const { queue, waiting } of depths) {
        observableResult.observe(waiting, { queue });
      }
    });
  }
}
