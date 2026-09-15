/**
 * Unit tests — AppMetricsService (HTTP recording, queue-depth gauge wiring).
 *
 * Spies on `metrics.getMeter` rather than exercising OTel's real aggregation
 * pipeline — this is a contract test against the `@opentelemetry/api` calls
 * our code makes, not a test of OTel's internals.
 */
import { metrics } from '@opentelemetry/api';
import { AppMetricsService } from './app-metrics.service';

interface FakeMeter {
  createHistogram: jest.Mock;
  createCounter: jest.Mock;
  createObservableGauge: jest.Mock;
}

function fakeMeter(): {
  meter: FakeMeter;
  histogram: { record: jest.Mock };
  counter: { add: jest.Mock };
  runGaugeCallback: (observe: jest.Mock) => Promise<void>;
} {
  const histogram = { record: jest.fn() };
  const counter = { add: jest.fn() };
  let gaugeCallback: ((result: { observe: jest.Mock }) => Promise<void>) | undefined;
  const gauge = {
    addCallback: jest.fn((cb: (result: { observe: jest.Mock }) => Promise<void>) => {
      gaugeCallback = cb;
    }),
  };
  const meter: FakeMeter = {
    createHistogram: jest.fn(() => histogram),
    createCounter: jest.fn(() => counter),
    createObservableGauge: jest.fn(() => gauge),
  };
  return {
    meter,
    histogram,
    counter,
    runGaugeCallback: async (observe) => {
      await gaugeCallback?.({ observe });
    },
  };
}

describe('AppMetricsService.recordHttpRequest', () => {
  it('records duration and count with method/route/status_code labels', () => {
    const { meter, histogram, counter } = fakeMeter();
    jest.spyOn(metrics, 'getMeter').mockReturnValue(meter as never);

    const service = new AppMetricsService();
    service.recordHttpRequest('GET', 'TaskController#list', 200, 0.042);

    const labels = { method: 'GET', route: 'TaskController#list', status_code: '200' };
    expect(histogram.record).toHaveBeenCalledWith(0.042, labels);
    expect(counter.add).toHaveBeenCalledWith(1, labels);
  });
});

describe('AppMetricsService.registerQueueDepth', () => {
  it('forwards each sampled queue depth to the gauge callback', async () => {
    const { meter, runGaugeCallback } = fakeMeter();
    jest.spyOn(metrics, 'getMeter').mockReturnValue(meter as never);

    const service = new AppMetricsService();
    const sample = jest.fn().mockResolvedValue([
      { queue: 'ai-jobs', waiting: 3 },
      { queue: 'ops-jobs', waiting: 0 },
    ]);
    service.registerQueueDepth(sample);

    const observe = jest.fn();
    await runGaugeCallback(observe);

    expect(sample).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(3, { queue: 'ai-jobs' });
    expect(observe).toHaveBeenCalledWith(0, { queue: 'ops-jobs' });
  });

  it('registers the gauge at most once even if called again', () => {
    const { meter } = fakeMeter();
    jest.spyOn(metrics, 'getMeter').mockReturnValue(meter as never);

    const service = new AppMetricsService();
    service.registerQueueDepth(jest.fn());
    service.registerQueueDepth(jest.fn());

    expect(meter.createObservableGauge).toHaveBeenCalledTimes(1);
  });
});
