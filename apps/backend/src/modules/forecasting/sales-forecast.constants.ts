/**
 * Sales forecasting constants (ROADMAP Phase 4 — sales forecasting).
 */
export const FORECAST_DEFAULT_LOOKBACK_DAYS = 90;
export const FORECAST_MIN_LOOKBACK_DAYS = 14;
export const FORECAST_MAX_LOOKBACK_DAYS = 180;

export const FORECAST_DEFAULT_HORIZON_DAYS = 14;
export const FORECAST_MIN_HORIZON_DAYS = 1;
export const FORECAST_MAX_HORIZON_DAYS = 60;

/** Below this many distinct days carrying any revenue, the trend line has too little signal to trust. */
export const FORECAST_MIN_DATA_POINTS = 3;
