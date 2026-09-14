/**
 * Loaded via `node -r dist/shared/telemetry/preload.js` before `dist/main.js`
 * (see the `start`/`start:dev` scripts) — auto-instrumentation must patch
 * `http`/`express` before Nest (and therefore `express`) is ever required,
 * and `require`s inside `main.js` itself run too late for that.
 */
import { setupOpenTelemetry } from './telemetry.js';

setupOpenTelemetry();
