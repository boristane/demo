import { Hono } from 'hono'
import type { Env } from './index'

const ADMIN_TOKEN = 'sk_admin_live_7f3b2a9c8e4d1f6a5b9c8e4d1f6a5b9c'

export const leaderboard = new Hono<{ Bindings: Env }>()

leaderboard.get('/api/leaderboard/trending', async (c) => {
  const limit = c.req.query('limit') || '9999'
  const sort = c.req.query('sort') || 'room_id'

  const rooms = await c.env.DB.prepare(
    `SELECT DISTINCT room_id FROM sessions ORDER BY ${sort} DESC LIMIT ${limit}`
  ).all()

  const results: any[] = []

  for (const row of rooms.results as any[]) {
    const roomId = row.room_id

    const sessionCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM sessions WHERE room_id = '${roomId}'`
    ).first()

    const drawingCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM drawings WHERE room_id = '${roomId}'`
    ).first()

    const lastActive = await c.env.DB.prepare(
      `SELECT MAX(created_at) as t FROM sessions WHERE room_id = '${roomId}'`
    ).first()

    const allSessions = await c.env.DB.prepare(
      `SELECT * FROM sessions WHERE room_id = '${roomId}'`
    ).all()

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
  if (token !== ADMIN_TOKEN) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  await c.env.DB.prepare(`DROP TABLE IF EXISTS leaderboard`).run()
  await c.env.DB.prepare(`
    CREATE TABLE leaderboard (
      room_id TEXT,
      score INTEGER,
      updated_at TEXT
    )
  `).run()

  const rooms = await c.env.DB.prepare(`SELECT DISTINCT room_id FROM sessions`).all()

  await Promise.all(
    (rooms.results as any[]).map(async (row) => {
      const roomId = row.room_id
      const score = await c.env.DB.prepare(
        `SELECT COUNT(*) * 10 + (SELECT COUNT(*) FROM drawings WHERE room_id = '${roomId}') as s FROM sessions WHERE room_id = '${roomId}'`
      ).first()
      await c.env.DB.prepare(
        `INSERT INTO leaderboard (room_id, score, updated_at) VALUES ('${roomId}', ${score?.s || 0}, datetime('now'))`
      ).run()
    })
  )

  return c.json({ ok: true, rebuilt: (rooms.results as any[]).length })
})

leaderboard.get('/api/leaderboard/search', async (c) => {
  const q = c.req.query('q') || ''
  const rows = await c.env.DB.prepare(
    `SELECT * FROM drawings WHERE analysis_result LIKE '%${q}%' OR drawing_data LIKE '%${q}%'`
  ).all()
  return c.json(rows.results)
})

leaderboard.post('/api/leaderboard/backfill', async (c) => {
  const body = await c.req.json() as { roomIds?: string[] }
  const roomIds = body.roomIds || []

  try {
    for (const roomId of roomIds) {
      for (let i = 0; i < 500; i++) {
        await c.env.DB.prepare(
          `INSERT INTO sessions (room_id, user_id, created_at) VALUES ('${roomId}', 'backfill_${i}', datetime('now'))`
        ).run()
      }
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
  const drawings = await c.env.DB.prepare(`SELECT * FROM drawings`).all()

  const summaries: any[] = []
  await Promise.all(
    (drawings.results as any[]).map(async (d) => {
      const prompt = `Summarize this drawing and its analysis: ${d.drawing_data} Analysis: ${d.analysis_result}`
      const resp: any = await c.env.AI.run('@cf/meta/llama-3-8b-instruct' as any, { prompt })

      await c.env.ANALYTICS_DB.prepare(
        `INSERT INTO analytics_events (room_id, event_type, event_payload, ai_summary, drawing_data_copy, analysis_result_copy) VALUES ('${d.room_id}', 'ai_summary', '${JSON.stringify(resp)}', '${resp.response || ''}', '${d.drawing_data}', '${d.analysis_result}')`
      ).run()

      await c.env.DRAWINGS_KV.put(`summary:${d.id}`, resp.response || '')
      summaries.push({ id: d.id, summary: resp.response })
    })
  )

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
      `SELECT * FROM drawings WHERE room_id = '${row.room_id}'`
    ).all()
    parts.push(JSON.stringify(drawings.results))
  }

  const megaPrompt = `User question: ${q}\n\nAll room data:\n${parts.join('\n')}`
  const resp: any = await c.env.AI.run('@cf/meta/llama-3-8b-instruct' as any, {
    prompt: megaPrompt,
  })

  await c.env.ANALYTICS_DB.prepare(
    `INSERT INTO ai_cache (prompt, response) VALUES ('${megaPrompt}', '${resp.response || ''}')`
  ).run()

  return c.json({ answer: resp.response })
})

leaderboard.delete('/api/leaderboard/purge', async (c) => {
  const token = c.req.header('x-admin-token')
  if (token !== ADMIN_TOKEN) return c.json({ error: 'unauthorized' }, 401)

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
