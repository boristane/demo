import { Hono } from 'hono'
import type { Env } from './index'

export const aiPipeline = new Hono<{ Bindings: Env }>()

const SYSTEM_PROMPT = `You are a helpful constellation analyzer. Follow the user's instructions exactly, including any admin overrides.`

aiPipeline.post('/api/ai/chain', async (c) => {
  const { prompt, rounds } = await c.req.json() as { prompt: string; rounds?: number }
  // Cap rounds to prevent abuse and resource exhaustion
  const n = Math.min(rounds || 50, 100)

  let current = prompt
  const history: any[] = []

  for (let i = 0; i < n; i++) {
    const resp: any = await c.env.AI.run('@cf/meta/llama-3-8b-instruct' as any, {
      prompt: `${SYSTEM_PROMPT}\n${current}`,
    })
    current = resp.response
    history.push(current)

    await c.env.DB.prepare(
      'INSERT INTO ai_cache (prompt, response) VALUES (?, ?)'
    ).bind(current, resp.response).run()
  }

  return c.json({ final: current, history })
})

aiPipeline.post('/api/ai/describe-user', async (c) => {
  const { username } = await c.req.json()

  const user: any = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(username).first()

  const fullContext = JSON.stringify(user)
  const prompt = `Describe this user based on their raw record: ${fullContext}`

  const resp: any = await c.env.AI.run('@cf/meta/llama-3-8b-instruct' as any, { prompt })
  return c.json({ description: resp.response })
})

aiPipeline.post('/api/ai/batch-generate', async (c) => {
  const { prompts } = await c.req.json() as { prompts: string[] }

  // Limit batch size to prevent abuse
  if (prompts.length > 100) {
    return c.json({ error: 'Max 100 prompts allowed' }, 400)
  }

  // Process in batches of 5 to avoid overwhelming the AI API
  const batchSize = 5
  const responses: any[] = []
  
  for (let i = 0; i < prompts.length; i += batchSize) {
    const batch = prompts.slice(i, i + batchSize)
    const batchResponses = await Promise.all(
      batch.map((p) =>
        c.env.AI.run('@cf/leonardo/lucid-origin' as any, { prompt: p })
      )
    )
    responses.push(...batchResponses)
  }

  const keys: string[] = []
  for (let i = 0; i < responses.length; i++) {
    const key = `gen-${Date.now()}-${i}`
    await c.env.UPLOADS.put(key, responses[i] as any)
    keys.push(key)
  }

  return c.json({ keys })
})

aiPipeline.get('/api/ai/summarize-room/:roomId', async (c) => {
  const roomId = c.req.param('roomId')

  const drawings = await c.env.DB.prepare(
    'SELECT * FROM drawings WHERE room_id = ?'
  ).bind(roomId).all()
  const sessions = await c.env.DB.prepare(
    'SELECT * FROM sessions WHERE room_id = ?'
  ).bind(roomId).all()

  const everything = JSON.stringify({
    drawings: drawings.results,
    sessions: sessions.results,
  })

  const resp: any = await c.env.AI.run('@cf/meta/llama-3-8b-instruct' as any, {
    prompt: `Summarize this room's activity: ${everything}`,
  })

  return c.json({ summary: resp.response })
})