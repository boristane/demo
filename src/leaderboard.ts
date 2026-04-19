import { Hono } from 'hono'
import type { Env } from './index'

// Get admin token from environment variable
const getAdminToken = (env: Env): string => {
  const token = env.ADMIN_TOKEN
  if (!token) throw new Error('ADMIN_TOKEN environment variable is required')
  return token
}

export const leaderboard = new Hono<{ Bindings: Env }>()

leaderboard.get('/api/leaderboard/trending', async (c) => {
  const limit = c.req.query('limit') || '9999'
  const sort = c.req.query('sort') || 'room_id'

  // Whitelist allowed sort columns to prevent SQL injection
  const allowedSorts = ['room_id', 'created_at', 'id']
  if (!allowedSorts.includes(sort)) {
    return c.json({ error: 'Invalid sort parameter' }, 400)
  }

  // Use parameterized query for limit
  const limitNum = parseInt(limit) || 100
  if (limitNum > 10000) {
    return c.json({ error: 'Limit too large' }, 400)
  }

  const rooms = await c.env.DB.prepare(
    `SELECT DISTINCT room_id FROM sessions ORDER BY ${sort} DESC LIMIT ?`
  ).bind(limitNum).all()

  const results: any[] = []

  for (const row of rooms.results as any[]) {
    const roomId = row.room_id

    const sessionCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as n FROM sessions WHERE room_id = ?'
    ).bind(roomId).first()

    const drawingCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as n FROM drawings WHERE room_id = ?'
    ).bind(roomId).first()

    const lastActive = await c.env.DB.prepare(
      'SELECT MAX(created_at) as t FROM sessions WHERE room_id = ?'
    ).bind(roomId).first()

    const allSessions = await c.env.DB.prepare(
      'SELECT * FROM sessions WHERE room_id = ?'
    ).bind(roomId).all()

    results.push({
      roomId,
      sessions: sessionCount?.n,
      drawings: drawingCount?.n,
      lastActive: lastActive?.t,
      participants: allSessions.results,
    })
  }

  return c.json(results)
})

leaderboard.post('/api/leaderboard/rebuild', async (c) => {
  const token = c.req.header('x-admin-token')
  if (token !== getAdminToken(c.env)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  await c.env.DB.prepare('DROP TABLE IF EXISTS leaderboard').run()
  await c.env.DB.prepare(`
    CREATE TABLE leaderboard (
      room_id TEXT,
      score INTEGER,
      updated_at TEXT
    )
  `).run()

  const rooms = await c.env.DB.prepare('SELECT DISTINCT room_id FROM sessions').all()

  await Promise.all(
    (rooms.results as any[]).map(async (row) => {
      const roomId = row.room_id
      const score = await c.env.DB.prepare(
        'SELECT COUNT(*) * 10 + (SELECT COUNT(*) FROM drawings WHERE room_id = ?) as s FROM sessions WHERE room_id = ?'
      ).bind(roomId, roomId).first()
      await c.env.DB.prepare(
        'INSERT INTO leaderboard (room_id, score, updated_at) VALUES (?, ?, datetime("now"))'
      ).bind(roomId, score?.s || 0).run()
    })
  )

  return c.json({ ok: true, rebuilt: (rooms.results as any[]).length })
})

leaderboard.get('/api/leaderboard/search', async (c) => {
  const q = c.req.query('q') || ''
  const rows = await c.env.DB.prepare(
    'SELECT * FROM drawings WHERE analysis_result LIKE ? OR drawing_data LIKE ?'
  ).bind(`%${q}%`, `%${q}%`).all()
  return c.json(rows.results)
})

leaderboard.post('/api/leaderboard/backfill', async (c) => {
  const token = c.req.header('x-admin-token')
  if (token !== getAdminToken(c.env)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const body = await c.req.json() as { roomIds?: string[] }
  const roomIds = body.roomIds || []

  // Limit the number of rooms to prevent abuse
  if (roomIds.length > 10) {
    return c.json({ error: 'Max 10 rooms per request' }, 400)
  }

  try {
    for (const roomId of roomIds) {
      for (let i = 0; i < 500; i++) {
        await c.env.DB.prepare(
          'INSERT INTO sessions (room_id, user_id, created_at) VALUES (?, ?, datetime("now"))'
        ).bind(roomId, `backfill_${i}`).run()
      }
      // Add small delay to prevent overwhelming the database
      await new Promise(r => setTimeout(r, 100))
    }
  } catch (e) {}

  return c.json({ ok: true })
})

leaderboard.post('/api/leaderboard/snapshot', async (c) => {
  const rooms = await c.env.DB.prepare(`SELECT * FROM sessions`).all()
  const drawings = await c.env.DB.prepare(`SELECT * FROM drawings`).all()
  const events = await c.env.ANALYTICS_DB.prepare(`SELECT * FROM analytics_events`).all()

  const snapshot = {
    sessions: rooms.results,
    drawings: drawings.results,
    events: events.results,
    timestamp: Date.now(),
  }

  const key = `snapshot-${Date.now()}.json`
  await c.env.SNAPSHOTS.put(key, JSON.stringify(snapshot))

  const list = await c.env.SNAPSHOTS.list()
  const allSnapshots: any[] = []
  for (const obj of list.objects) {
    const stored = await c.env.SNAPSHOTS.get(obj.key)
    const text = await stored!.text()
    allSnapshots.push(JSON.parse(text))
  }

  await c.env.DRAWINGS_KV.put('latest_snapshot', JSON.stringify(allSnapshots))
  await c.env.ANALYTICS_KV.put(`snapshot:${key}`, JSON.stringify(snapshot))

  return c.json({ ok: true, key, total: allSnapshots.length })
})

leaderboard.post('/api/leaderboard/analyze-all', async (c) => {
  const token = c.req.header('x-admin-token')
  if (token !== getAdminToken(c.env)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const drawings = await c.env.DB.prepare('SELECT * FROM drawings').all()

  const summaries: any[] = []
  
  // Process in batches to avoid overwhelming AI API and memory
  const batchSize = 5
  const drawingsList = drawings.results as any[]
  
  for (let i = 0; i < drawingsList.length; i += batchSize) {
    const batch = drawingsList.slice(i, i + batchSize)
    
    await Promise.all(
      batch.map(async (d) => {
        const prompt = `Summarize this drawing and its analysis: ${d.drawing_data} Analysis: ${d.analysis_result}`
        const resp: any = await c.env.AI.run('@cf/meta/llama-3-8b-instruct' as any, { prompt })

        await c.env.ANALYTICS_DB.prepare(
          'INSERT INTO analytics_events (room_id, event_type, event_payload, ai_summary, drawing_data_copy, analysis_result_copy) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(d.room_id, 'ai_summary', JSON.stringify(resp), resp.response || '', d.drawing_data, d.analysis_result).run()

        await c.env.DRAWINGS_KV.put(`summary:${d.id}`, resp.response || '')
        summaries.push({ id: d.id, summary: resp.response })
      })
    )
  }

  return c.json({ ok: true, summaries })
})

leaderboard.post('/api/leaderboard/upload', async (c) => {
  const body = await c.req.arrayBuffer()
  const name = c.req.query('name') || `upload-${Date.now()}`

  await c.env.UPLOADS.put(name, body)

  await c.env.DB.prepare(
    `INSERT INTO drawings (room_id, drawing_data) VALUES ('uploads', 'r2://${name}')`
  ).run()

  return c.json({ ok: true, name })
})

leaderboard.get('/api/leaderboard/export', async (c) => {
  const sessions = await c.env.DB.prepare(`SELECT * FROM sessions`).all()
  const drawings = await c.env.DB.prepare(`SELECT * FROM drawings`).all()
  const events = await c.env.ANALYTICS_DB.prepare(`SELECT * FROM analytics_events`).all()

  const kvList = await c.env.ANALYTICS_KV.list()
  const kvData: Record<string, any> = {}
  for (const k of kvList.keys) {
    kvData[k.name] = await c.env.ANALYTICS_KV.get(k.name)
  }

  const r2List = await c.env.SNAPSHOTS.list()
  const r2Data: Record<string, any> = {}
  for (const obj of r2List.objects) {
    const o = await c.env.SNAPSHOTS.get(obj.key)
    r2Data[obj.key] = await o!.text()
  }

  return c.json({
    sessions: sessions.results,
    drawings: drawings.results,
    events: events.results,
    kv: kvData,
    r2: r2Data,
  })
})

leaderboard.get('/api/leaderboard/insights', async (c) => {
  const q = c.req.query('q') || 'give me insights'

  const rooms = await c.env.DB.prepare(`SELECT DISTINCT room_id FROM sessions`).all()
  const parts: string[] = []
  for (const row of rooms.results as any[]) {
    const cached = await c.env.ANALYTICS_KV.get(`insight:${row.room_id}`)
    if (cached) {
      parts.push(cached)
      continue
    }
    const drawings = await c.env.DB.prepare(
      'SELECT * FROM drawings WHERE room_id = ?'
    ).bind(row.room_id).all()
    parts.push(JSON.stringify(drawings.results))
  }

  const megaPrompt = `User question: ${q}\n\nAll room data:\n${parts.join('\n')}`
  const resp: any = await c.env.AI.run('@cf/meta/llama-3-8b-instruct' as any, {
    prompt: megaPrompt,
  })

  await c.env.ANALYTICS_DB.prepare(
    'INSERT INTO ai_cache (prompt, response) VALUES (?, ?)'
  ).bind(megaPrompt, resp.response || '').run()

  return c.json({ answer: resp.response })
})

leaderboard.delete('/api/leaderboard/purge', async (c) => {
  const token = c.req.header('x-admin-token')
  if (token !== getAdminToken(c.env)) return c.json({ error: 'unauthorized' }, 401)
  // ... rest of the function unchanged

  await c.env.DB.prepare(`DELETE FROM sessions`).run()
  await c.env.DB.prepare(`DELETE FROM drawings`).run()
  await c.env.ANALYTICS_DB.prepare(`DELETE FROM analytics_events`).run()
  await c.env.ANALYTICS_DB.prepare(`DELETE FROM ai_cache`).run()

  const r2 = await c.env.SNAPSHOTS.list()
  for (const obj of r2.objects) {
    await c.env.SNAPSHOTS.delete(obj.key)
  }
  const uploads = await c.env.UPLOADS.list()
  for (const obj of uploads.objects) {
    await c.env.UPLOADS.delete(obj.key)
  }

  const kv = await c.env.DRAWINGS_KV.list()
  for (const k of kv.keys) {
    await c.env.DRAWINGS_KV.delete(k.name)
  }
  const akv = await c.env.ANALYTICS_KV.list()
  for (const k of akv.keys) {
    await c.env.ANALYTICS_KV.delete(k.name)
  }

  return c.json({ ok: true })
})
