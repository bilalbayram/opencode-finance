export class PoliticalBacktestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "PoliticalBacktestError"
  }
}

export class MissingRequiredFieldError extends PoliticalBacktestError {
  constructor(field: string, details?: Record<string, unknown>) {
    super(`Missing required field: ${field}`, "MISSING_REQUIRED_FIELD", details)
    this.name = "MissingRequiredFieldError"
  }
}

export class InvalidDateError extends PoliticalBacktestError {
  constructor(field: string, value: unknown, details?: Record<string, unknown>) {
    super(`Invalid date in field ${field}: ${String(value)}`, "INVALID_DATE", details)
    this.name = "InvalidDateError"
  }
}

export class InvalidQuiverRowError extends PoliticalBacktestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "INVALID_QUIVER_ROW", details)
    this.name = "InvalidQuiverRowError"
  }
}

export class TradingCalendarError extends PoliticalBacktestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "TRADING_CALENDAR_ERROR", details)
    this.name = "TradingCalendarError"
  }
}

export class SessionAlignmentError extends PoliticalBacktestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "SESSION_ALIGNMENT_ERROR", details)
    this.name = "SessionAlignmentError"
  }
}

export class InvalidWindowError extends PoliticalBacktestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "INVALID_WINDOW", details)
    this.name = "InvalidWindowError"
  }
}

export class PriceSeriesError extends PoliticalBacktestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "PRICE_SERIES_ERROR", details)
    this.name = "PriceSeriesError"
  }
}

export class MissingPriceError extends PriceSeriesError {
  constructor(symbol: string, date: string, details?: Record<string, unknown>) {
    super(`Missing close price for ${symbol} on ${date}`, details)
    this.name = "MissingPriceError"
  }
}

export class StatsComputationError extends PoliticalBacktestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "STATS_COMPUTATION_ERROR", details)
    this.name = "StatsComputationError"
  }
}

export const EVENT_STUDY_ERROR_CODE = [
  "MISSING_REQUIRED_ANCHOR_DATE",
  "INVALID_EVENT_DATE",
  "EMPTY_EVENT_SET",
  "DUPLICATE_EVENT_ID",
  "MISSING_PRICE_SERIES",
  "INVALID_PRICE_SERIES",
  "ANCHOR_OUT_OF_RANGE",
  "WINDOW_OUT_OF_RANGE",
  "MISSING_BENCHMARK_SERIES",
  "MISSING_BENCHMARK_MAPPING",
] as const

export type EventStudyErrorCode = (typeof EVENT_STUDY_ERROR_CODE)[number]

function inferCode(error: unknown): EventStudyErrorCode {
  if (error instanceof MissingRequiredFieldError) return "MISSING_REQUIRED_ANCHOR_DATE"
  if (error instanceof InvalidDateError) return "INVALID_EVENT_DATE"
  if (error instanceof InvalidQuiverRowError) return "INVALID_EVENT_DATE"
  if (error instanceof MissingPriceError) return "MISSING_PRICE_SERIES"
  if (error instanceof PriceSeriesError) return "INVALID_PRICE_SERIES"
  if (error instanceof TradingCalendarError) return "INVALID_PRICE_SERIES"
  if (error instanceof SessionAlignmentError) return "ANCHOR_OUT_OF_RANGE"
  if (error instanceof InvalidWindowError) return "WINDOW_OUT_OF_RANGE"
  if (error instanceof StatsComputationError) return "INVALID_PRICE_SERIES"
  return "INVALID_EVENT_DATE"
}

export class EventStudyError extends Error {
  constructor(
    message: string,
    public readonly code: EventStudyErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "EventStudyError"
  }

  static wrap(error: unknown, fallbackCode?: EventStudyErrorCode): EventStudyError {
    if (error instanceof EventStudyError) return error
    if (error instanceof Error) {
      return new EventStudyError(error.message, fallbackCode ?? inferCode(error), {
        cause: error.name,
      })
    }
    return new EventStudyError(String(error), fallbackCode ?? inferCode(error))
  }
}
