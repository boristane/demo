import type { MiddlewareHandler, Next } from 'hono'
import { createLogger, WideEventBuilder } from '../logger'
import type { AppContext } from '../types'

/**  
 * Hono middleware for wide event logging  
 * Creates a single structured log entry per HTTP request with timing and context  
 */
export function wideEventLogger(): MiddlewareHandler {
  return async (c: AppContext, next: Next) => {
    const logger = createLogger(c as unknown as { env: { STAGE?: string } })
    const requestId = c.req.header('x-request-id') || logger.generateRequestId()
    
    // Set request ID on context for downstream use
    c.set('requestId', requestId)
    
    const wideEvent = new WideEventBuilder(logger, {
      requestId,
      method: c.req.method,
      path: c.req.path,
    })
    
    // Add user agent and client context
    wideEvent.add({
      user_agent: c.req.header('user-agent'),
      cf_ray: c.req.header('cf-ray'),
      cf_country: c.req.header('cf-ipcountry'),
    })
    
    try {
      await next()
      
      // Get status code after handler execution
      const status = c.res.status
      const outcome = status >= 400 ? 'error' : 'success'
      
      wideEvent.complete(status, outcome)
    } catch (error) {
      const status = 500
      const err = error instanceof Error ? error : new Error(String(error))
      
      wideEvent.completeWithError(status, err)
      throw error // Re-throw to let Hono handle response
    }
  }
}
