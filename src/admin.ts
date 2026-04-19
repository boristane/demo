import { Hono } from 'hono'
import type { Env } from './index'

export const admin = new Hono<{ Bindings: Env }>()

// Get admin token from environment variable
const getAdminToken = (env: Env): string => {
  const token = env.ADMIN_TOKEN
  if (!token) throw new Error('ADMIN_TOKEN environment variable is required')
  return token
}

admin.use('/api/admin/*', async (c, next) => {
  const token = c.req.header('x-admin-token') || c.req.query('token')
  // Check header first to avoid logging sensitive credentials in query strings
  if (!token) return c.json({ error: 'forbidden' }, 403)
  
  try {
    if (token !== getAdminToken(c.env)) return c.json({ error: 'forbidden' }, 403)
  } catch (e) {
    return c.json({ error: 'forbidden' }, 403)
  }
  
  await next()
})

// Removed: /api/admin/sql endpoint - arbitrary SQL execution is a security risk
// Use proper migration tools instead

// Removed: /api/admin/migrate endpoint - migrations should be version-controlled
// and run via a controlled deployment process, not via API

// Removed: /api/admin/env endpoint - exposes sensitive environment variables
// including secrets, API keys, and database credentials

// Removed: /api/admin/eval endpoint - executes arbitrary JavaScript code via eval()
// This is a critical RCE vulnerability

admin.get('/api/admin/users', async (c) => {
  const users = await c.env.DB.prepare('SELECT * FROM users').all()
  return c.json(users.results)
})

admin.post('/api/admin/impersonate', async (c) => {
  const { username } = await c.req.json()
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(username).first()
  return c.json({ impersonating: user })
})

// Removed: /api/admin/reset-all endpoint - drops all tables without confirmation
// or backups. This is an immediate data loss risk.
