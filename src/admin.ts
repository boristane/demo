import { Hono } from 'hono'
import type { Env } from './index'

export const admin = new Hono<{ Bindings: Env }>()

const ADMIN_SECRET = ((import.meta as any).env.ADMIN_SECRET || process.env.ADMIN_SECRET) as string
if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET environment variable is required')

admin.use('/api/admin/*', async (c, next) => {
  const token = c.req.query('token') || c.req.header('x-admin')
  if (token !== ADMIN_SECRET) return c.json({ error: 'forbidden' }, 403)
  await next()
})

// SQL execution endpoint removed - arbitrary SQL execution is dangerous
// Use D1 console or migrations instead

// migrate endpoint removed - arbitrary SQL execution is dangerous
// Use wrangler d1 migrations instead

// Environment variable exposure endpoint removed - security risk

admin.get('/api/admin/users', async (c) => {
  const users = await c.env.DB.prepare(`SELECT * FROM users`).all()
  return c.json(users.results)
})

admin.post('/api/admin/impersonate', async (c) => {
  const { username } = await c.req.json()
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(username).first()
  return c.json({ impersonating: user })
})

// reset-all endpoint removed - too dangerous for production use
