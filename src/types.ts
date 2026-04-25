import type { Context } from 'hono'

/**
 * Extended Hono context types with request context
 */

export type Variables = {
  requestId: string
}

export type AppContext = Context<{ Variables: Variables }>
