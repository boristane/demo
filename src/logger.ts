/**
 * Structured logger implementing the wide events pattern
 * Emits a single context-rich JSON event per request/operation
 */

export type LogLevel = 'info' | 'error'

export interface LoggerConfig {
  service: string
  version: string
  environment: string
  region?: string
}

export class Logger {
  constructor(private config: LoggerConfig) {}

  /**
   * Create a base event with environment context pre-populated
   */
  baseEvent(): Record<string, unknown> {
    return {
      timestamp: new Date().toISOString(),
      service: this.config.service,
      version: this.config.version,
      environment: this.config.environment,
      ...(this.config.region && { region: this.config.region }),
    }
  }

  /**
   * Generate a unique request ID for correlation
   */
  generateRequestId(): string {
    return `${this.config.service}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Log structured wide event
   */
  log(level: LogLevel, event: Record<string, unknown>): void {
    const fullEvent = {
      level,
      ...this.baseEvent(),
      ...event,
    }
    
    // Use console for Workers environment - logs are captured by Cloudflare
    if (level === 'error') {
      console.error(JSON.stringify(fullEvent))
    } else {
      console.log(JSON.stringify(fullEvent))
    }
  }

  info(event: Record<string, unknown>): void {
    this.log('info', event)
  }

  error(event: Record<string, unknown>): void {
    this.log('error', event)
  }
}

/**
 * Wide event builder for accumulating context throughout a request
 */
export class WideEventBuilder {
  private startTime: number
  private event: Record<string, unknown>

  constructor(
    logger: Logger,
    baseContext: {
      requestId: string
      method: string
      path: string
    }
  ) {
    this.startTime = Date.now()
    this.event = {
      ...logger.baseEvent(),
      request_id: baseContext.requestId,
      method: baseContext.method,
      path: baseContext.path,
    }
  }

  /**
   * Add additional fields to the wide event
   */
  add(fields: Record<string, unknown>): this {
    Object.assign(this.event, fields)
    return this
  }

  /**
   * Record outcome and emit the complete wide event
   */
  complete(statusCode: number, outcome: 'success' | 'error'): void {
    this.event.status_code = statusCode
    this.event.outcome = outcome
    this.event.duration_ms = Date.now() - this.startTime
    
    // Emit to console for Workers environment
    console.log(JSON.stringify({
      level: outcome === 'error' ? 'error' : 'info',
      ...this.event
    }))
  }

  /**
   * Record error context and emit the event
   */
  completeWithError(statusCode: number, error: Error): void {
    this.event.status_code = statusCode
    this.event.outcome = 'error'
    this.event.error = {
      type: error.name,
      message: error.message,
    }
    this.event.duration_ms = Date.now() - this.startTime
    
    console.error(JSON.stringify({
      level: 'error',
      ...this.event
    }))
  }
}

/**
 * Create a logger from environment bindings
 */
export function createLogger(c: { env: { STAGE?: string } }): Logger {
  return new Logger({
    service: 'constellation-connect',
    version: '0.0.0',
    environment: c.env.STAGE || 'development',
    region: 'auto',
  })
}
