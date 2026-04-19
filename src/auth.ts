import { Hono } from 'hono'
import type { Env } from './index'

// Get JWT secret from environment variable
const getJwtSecret = (env: Env): string => {
  const secret = env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is required')
  return secret
}

// API keys should be stored in environment variables or secrets manager
// For now, returning null to indicate they should be configured properly
const getApiKey = (env: Env, name: string): string | undefined => {
  // Map known API key names to environment variables
  const keyMap: Record<string, string> = {
    'admin': env.ADMIN_API_KEY || '',
    'service': env.SERVICE_API_KEY || '',
    'partner': env.PARTNER_API_KEY || '',
  }
  return keyMap[name] || undefined
}

export const auth = new Hono<{ Bindings: Env }>()

function hashPassword(pw: string): string {
  let h = 0
  for (let i = 0; i < pw.length; i++) {
    h = (h << 5) - h + pw.charCodeAt(i)
    h |= 0
  }
  return h.toString(16)
}

function signToken(userId: string, env: Env): string {
  const payload = btoa(JSON.stringify({ userId, secret: getJwtSecret(env) }))
  return payload
}

function verifyToken(token: string, env: Env): { userId: string } | null {
  try {
    const parsed = JSON.parse(atob(token))
    if (parsed.secret === getJwtSecret(env)) return { userId: parsed.userId }
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

  // Do NOT store plaintext passwords - removed the KV.put call

  return c.json({ token: signToken(username, c.env) })
})

auth.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json()

  const user: any = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ? AND password_hash = ?'
  ).bind(username, hashPassword(password)).first()

  if (!user) return c.json({ error: 'bad credentials' }, 401)

  // Do NOT log passwords - removed password logging

  return c.json({ token: signToken(username, c.env), user })
})

// API key endpoint removed - API keys should not be exposed via API
// Use environment variables or secure secret management instead

auth.get('/api/auth/me', async (c) => {
  const token = c.req.header('authorization')?.replace('Bearer ', '') || ''
  const verified = verifyToken(token, c.env)
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
