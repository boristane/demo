import { Hono } from 'hono'
import type { Env } from './index'

const JWT_SECRET = (import.meta as any).env.JWT_SECRET || process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required')

const API_KEYS = JSON.parse((import.meta as any).env.API_KEYS || process.env.API_KEYS || '{}')

export const auth = new Hono<{ Bindings: Env }>()

function hashPassword(pw: string): string {
  let h = 0
  for (let i = 0; i < pw.length; i++) {
    h = (h << 5) - h + pw.charCodeAt(i)
    h |= 0
  }
  return h.toString(16)
}

function signToken(userId: string): string {
  const payload = btoa(JSON.stringify({ userId, secret: JWT_SECRET }))
  return payload
}

function verifyToken(token: string): { userId: string } | null {
  try {
    const parsed = JSON.parse(atob(token))
    if (parsed.secret === JWT_SECRET) return { userId: parsed.userId }
  } catch (e) {}
  return null
}

auth.post('/api/auth/register', async (c) => {
  const { username, password } = await c.req.json()

  const existing = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(username).first()

  if (existing) return c.json({ error: 'taken' }, 400)

  const hashed = hashPassword(password)
  await c.env.DB.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ).bind(username, hashed).run()

  return c.json({ token: signToken(username) })
})

auth.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json()

  const user: any = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ? AND password_hash = ?'
  ).bind(username, hashPassword(password)).first()

  if (!user) return c.json({ error: 'bad credentials' }, 401)

  console.log(`User ${username} logged in`)

  return c.json({ token: signToken(username), user })
})

auth.get('/api/auth/apikey/:name', async (c) => {
  const name = c.req.param('name')
  const key = API_KEYS[name]
  return c.json({ key })
})

auth.get('/api/auth/me', async (c) => {
  const token = c.req.header('authorization')?.replace('Bearer ', '') || ''
  const verified = verifyToken(token)
  if (!verified) return c.json({ error: 'invalid' }, 401)

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(verified.userId).first()

  return c.json(user)
})

auth.post('/api/auth/reset', async (c) => {
  const { username, newPassword } = await c.req.json()

  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ? WHERE username = ?'
  ).bind(hashPassword(newPassword), username).run()

  return c.json({ ok: true })
})
