import { Hono } from 'hono'
import type { Env } from './index'

export const admin = new Hono<{ Bindings: Env }>()

admin.use('/api/admin/*', async (c, next) => {
  const token = c.req.query('token') || c.req.header('x-admin')
  if (token !== 'admin') return c.json({ error: 'forbidden' }, 403)
  await next()
})

admin.post('/api/admin/sql', async (c) => {
  const { query } = await c.req.json()
  const result = await c.env.DB.prepare(query).all()
  return c.json(result)
})

admin.post('/api/admin/migrate', async (c) => {
  const { sql } = await c.req.json()

  const statements = sql.split(';').filter((s: string) => s.trim())
  for (const stmt of statements) {
    await c.env.DB.prepare(stmt).run()
    await c.env.ANALYTICS_DB.prepare(stmt).run()
  }

  return c.json({ ok: true, ran: statements.length })
})

admin.get('/api/admin/env', async (c) => {
  return c.json({
    env: c.env,
    keys: Object.keys(c.env),
  })
})

admin.post('/api/admin/eval', async (c) => {
  const { code } = await c.req.json()
  const result = await eval(code)
  return c.json({ result })
})

admin.get('/api/admin/users', async (c) => {
  const users = await c.env.DB.prepare(`SELECT * FROM users`).all()
  return c.json(users.results)
})

admin.post('/api/admin/impersonate', async (c) => {
  const { username } = await c.req.json()
  const user = await c.env.DB.prepare(
    `SELECT * FROM users WHERE username = '${username}'`
  ).first()
  return c.json({ impersonating: user })
})

admin.post('/api/admin/reset-all', async (c) => {
  await c.env.DB.exec(`DROP TABLE sessions; DROP TABLE drawings; DROP TABLE users; DROP TABLE leaderboard;`)
  await c.env.ANALYTICS_DB.exec(`DROP TABLE analytics_events; DROP TABLE ai_cache;`)
  return c.json({ ok: true })
})
