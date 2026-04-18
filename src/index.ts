import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  DRAWING_ROOM: DurableObjectNamespace
  DRAWINGS_KV: KVNamespace
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
}

interface Point {
  x: number
  y: number
}

interface Line {
  from: Point
  to: Point
  userId: string
  color: string
}

interface TimedLine extends Line {
  t: number
}

interface Participant {
  name: string
  color: string
}

interface ActiveBattle {
  battleId: number
  prompt: string
  endsAt: number
}

interface DrawingMessage {
  type:
    | 'join'
    | 'draw_line'
    | 'clear'
    | 'user_joined'
    | 'user_left'
    | 'line_drawn'
    | 'canvas_cleared'
    | 'init'
    | 'constellation_found'
    | 'battle_started'
    | 'battle_ended'
    | 'activate_battle'
  userId?: string
  name?: string
  color?: string
  from?: Point
  to?: Point
  participants?: Array<[string, Participant]>
  lines?: TimedLine[]
  result?: string
  battle?: ActiveBattle | null
  battleId?: number
  prompt?: string
  durationSeconds?: number
  endsAt?: number
}

const COLORS = [
  '#e91e63',
  '#9c27b0',
  '#673ab7',
  '#3f51b5',
  '#2196f3',
  '#00bcd4',
  '#009688',
  '#4caf50',
  '#8bc34a',
  '#ff9800',
  '#ff5722',
  '#795548',
]

const MAX_LINES = 2000

export class DrawingRoom {
  private state: DurableObjectState
  private sessions: Map<WebSocket, string> = new Map()
  private participants: Map<string, Participant> = new Map()
  private lines: TimedLine[] = []
  private colorIndex = 0
  private activeBattle: ActiveBattle | null = null
  private hydrated = false

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
  }

  private async hydrate() {
    if (this.hydrated) return
    this.hydrated = true
    const [lines, colorIndex, battle] = await Promise.all([
      this.state.storage.get<TimedLine[]>('lines'),
      this.state.storage.get<number>('colorIndex'),
      this.state.storage.get<ActiveBattle | null>('activeBattle'),
    ])
    if (lines) this.lines = lines
    if (typeof colorIndex === 'number') this.colorIndex = colorIndex
    if (battle && battle.endsAt > Date.now()) this.activeBattle = battle
  }

  async fetch(request: Request) {
    await this.hydrate()
    const url = new URL(request.url)

    if (url.pathname === '/websocket') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 400 })
      }
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      await this.handleSession(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === '/snapshot') {
      return Response.json({
        lines: this.lines,
        participants: Array.from(this.participants.entries()),
        activeBattle: this.activeBattle,
      })
    }

    if (url.pathname === '/battle/start' && request.method === 'POST') {
      const body = (await request.json()) as ActiveBattle
      this.activeBattle = body
      await this.state.storage.put('activeBattle', this.activeBattle)
      this.broadcast({ type: 'battle_started', battle: this.activeBattle })
      return Response.json({ ok: true })
    }

    if (url.pathname === '/battle/clear' && request.method === 'POST') {
      this.activeBattle = null
      await this.state.storage.put('activeBattle', null)
      this.broadcast({ type: 'battle_ended' })
      return Response.json({ ok: true })
    }

    if (url.pathname === '/clear' && request.method === 'POST') {
      this.lines = []
      await this.state.storage.put('lines', this.lines)
      this.broadcast({ type: 'canvas_cleared' })
      return Response.json({ ok: true })
    }

    return new Response('Not found', { status: 404 })
  }

  async handleSession(webSocket: WebSocket) {
    webSocket.accept()
    const userId = crypto.randomUUID()
    this.sessions.set(webSocket, userId)

    webSocket.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data as string) as DrawingMessage
        switch (message.type) {
          case 'join': {
            const color = COLORS[this.colorIndex % COLORS.length]
            this.colorIndex++
            this.participants.set(userId, {
              name: message.name || 'Anonymous',
              color,
            })
            webSocket.send(
              JSON.stringify({
                type: 'init',
                userId,
                color,
                participants: Array.from(this.participants.entries()),
                lines: this.lines,
                battle: this.activeBattle,
              })
            )
            this.broadcast(
              { type: 'user_joined', userId, name: message.name, color },
              webSocket
            )
            await this.state.storage.put('colorIndex', this.colorIndex)
            break
          }

          case 'draw_line': {
            const participant = this.participants.get(userId)
            if (!participant || !message.from || !message.to) break
            const line: TimedLine = {
              from: message.from,
              to: message.to,
              userId,
              color: participant.color,
              t: Date.now(),
            }
            this.lines.push(line)
            if (this.lines.length > MAX_LINES) {
              this.lines = this.lines.slice(-Math.floor(MAX_LINES / 2))
            }
            this.broadcast({
              type: 'line_drawn',
              from: line.from,
              to: line.to,
              color: line.color,
              userId,
            })
            // Fire-and-forget persist; strokes can be high-frequency.
            this.state.storage.put('lines', this.lines).catch(() => {})
            break
          }

          case 'clear': {
            this.lines = []
            await this.state.storage.put('lines', this.lines)
            this.broadcast({ type: 'canvas_cleared' })
            break
          }

          case 'activate_battle': {
            if (
              typeof message.battleId === 'number' &&
              typeof message.prompt === 'string' &&
              typeof message.endsAt === 'number'
            ) {
              this.activeBattle = {
                battleId: message.battleId,
                prompt: message.prompt,
                endsAt: message.endsAt,
              }
              await this.state.storage.put('activeBattle', this.activeBattle)
              this.broadcast({ type: 'battle_started', battle: this.activeBattle })
            }
            break
          }
        }
      } catch (error) {
        console.error('Error handling message:', error)
      }
    })

    webSocket.addEventListener('close', async () => {
      this.sessions.delete(webSocket)
      const participant = this.participants.get(userId)
      if (participant) {
        this.participants.delete(userId)
        this.broadcast({ type: 'user_left', userId })
      }
    })
  }

  broadcast(message: DrawingMessage, exclude?: WebSocket) {
    const messageStr = JSON.stringify(message)
    this.sessions.forEach((_, ws) => {
      if (ws !== exclude && ws.readyState === WebSocket.READY_STATE_OPEN) {
        try {
          ws.send(messageStr)
        } catch {}
      }
    })
  }
}

// --- Helpers ----------------------------------------------------------------

async function fingerprint(req: Request): Promise<string> {
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for') ||
    'unknown'
  const ua = req.headers.get('user-agent') || ''
  const data = new TextEncoder().encode(`${ip}::${ua}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function extractAiText(response: unknown): string {
  if (!response) return ''
  if (typeof response === 'string') return response
  if (typeof response === 'object') {
    const r = response as Record<string, unknown>
    for (const key of ['response', 'description', 'text', 'result']) {
      const v = r[key]
      if (typeof v === 'string') return v
    }
  }
  return ''
}

function parseBattleScore(text: string): { score: number; feedback: string } {
  const scoreMatch = text.match(/SCORE\s*[:=]\s*(\d{1,3})/i)
  const feedbackMatch = text.match(/FEEDBACK\s*[:=]\s*(.+)/is)
  let score = scoreMatch ? parseInt(scoreMatch[1], 10) : NaN
  if (!Number.isFinite(score)) {
    // Fall back: find any number 0-100 in the text.
    const any = text.match(/\b(\d{1,3})\b/)
    score = any ? parseInt(any[1], 10) : 50
  }
  score = Math.max(0, Math.min(100, score))
  const feedback = feedbackMatch ? feedbackMatch[1].trim() : text.trim().slice(0, 240)
  return { score, feedback }
}

// --- Hono app ---------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>()

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

function getRoom(env: Env, roomId: string) {
  const id = env.DRAWING_ROOM.idFromName(roomId)
  return env.DRAWING_ROOM.get(id)
}

app.get('/api/room/:roomId/websocket', async (c) => {
  const roomId = c.req.param('roomId')
  const room = getRoom(c.env, roomId)
  return room.fetch(new Request('http://fake-host/websocket', {
    headers: { 'Upgrade': 'websocket' },
  }))
})

app.post('/api/analyze', async (c) => {
  try {
    const { imageData } = await c.req.json<{ imageData: string }>()
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '')
    const imageBuffer = Uint8Array.from(atob(base64Data), char => char.charCodeAt(0))

    const identificationPrompt = `
Analyze this hand-drawn image and transform it into a realistic NASA constellation story:

1. **Shape Recognition**: What shape or pattern do you see in this drawing?
2. **Constellation Name**: Give it a creative, space-inspired name
3. **Mythological Story**: Create a brief, story about this constellation (2-3 sentences)
4. **Key Stars**: Identify the brightest stars and what they represent in your story
5. **Special Features**: Note any unique patterns or clusters that make this constellation special

Be imaginative and poetic - every drawing tells a celestial story!
`

    const detailPrompt = `Describe this drawing's star pattern in detail for creating a beautiful night sky scene:

- Where are the main stars/points located (upper, middle, lower regions)?
- How are they connected (straight lines, curves, clusters)?
- What's the overall shape and flow of the pattern?
- Which areas should have bright stars vs dim ones?
- Any special features like star clusters or empty spaces?

Focus on the actual drawing pattern, not interpretation.`

    const [identificationResponse, detailResponse] = await Promise.all([
      c.env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
        image: [...imageBuffer],
        prompt: identificationPrompt,
      }),
      c.env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
        image: [...imageBuffer],
        prompt: detailPrompt,
      }),
    ])

    const detailedDescription =
      extractAiText(detailResponse) ||
      'A constellation pattern drawn in the night sky with bright stars connected by faint lines'

    const backgroundStyles = [
      'aurora borealis green and purple dancing lights',
      'deep purple and pink nebula clouds swirling',
      'sunset orange and red twilight sky transitioning to night',
      'teal and cyan cosmic dust with distant galaxies',
      'rose gold dawn sky with morning stars',
      'indigo midnight with silver moonlight',
      'emerald and sapphire cosmic ocean',
      'crimson and gold stellar nursery',
    ]
    const atmosphericEffects = [
      'ethereal mist and star fog',
      'shimmering stardust particles',
      'flowing cosmic rivers of light',
      'crystalline ice clouds catching starlight',
      'bioluminescent space clouds',
      'prismatic light refractions',
    ]
    const randomBackground = backgroundStyles[Math.floor(Math.random() * backgroundStyles.length)]
    const randomEffect = atmosphericEffects[Math.floor(Math.random() * atmosphericEffects.length)]

    const identificationText = extractAiText(identificationResponse) || 'a celestial pattern'
    const imageGenerationPrompt = `Magical constellation art: Transform "${identificationText}" into a stunning constellation pattern. ${detailedDescription}. Background: ${randomBackground}. Atmosphere: ${randomEffect}. Bright twinkling stars connected by faint ethereal lines forming the shape, ${randomBackground}, dreamy and fantastical, highly artistic, varied and creative color palette, NOT plain blue sky, masterpiece quality`

    const skyViewResponse = await c.env.AI.run(
      '@cf/leonardo/lucid-origin' as any,
      { prompt: imageGenerationPrompt }
    )

    const analysisId = `analysis_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    await c.env.DRAWINGS_KV.put(
      analysisId,
      JSON.stringify({
        identification: identificationResponse,
        skyView: skyViewResponse,
        timestamp: Date.now(),
      }),
      { expirationTtl: 86400 }
    )

    return c.json({
      analysisId,
      result: identificationResponse,
      skyView: skyViewResponse,
      backgroundStyle: randomBackground,
    })
  } catch (error) {
    console.error('Analysis error:', error)
    return c.json({ error: 'Analysis failed' }, 500)
  }
})

app.post('/api/session', async (c) => {
  try {
    const { roomId, userId } = await c.req.json<{ roomId: string; userId: string }>()
    await c.env.DB.prepare(`
      INSERT INTO sessions (room_id, user_id, created_at)
      VALUES (?, ?, datetime('now'))
    `).bind(roomId, userId).run()
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: 'Failed to create session' }, 500)
  }
})

app.get('/api/stats', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT COUNT(*) as total_sessions,
             COUNT(DISTINCT room_id) as unique_rooms
      FROM sessions
      WHERE created_at > datetime('now', '-24 hours')
    `).first()
    return c.json({
      totalSessions: result?.total_sessions || 0,
      uniqueRooms: result?.unique_rooms || 0,
      timestamp: Date.now(),
    })
  } catch (error) {
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
})

// --- Gallery ----------------------------------------------------------------

app.post('/api/gallery/save', async (c) => {
  try {
    const body = await c.req.json<{
      roomId: string
      title: string
      story?: string
      skyViewImage?: string // base64 (no data-url prefix)
      strokes: TimedLine[]
      creators?: string[]
    }>()

    if (!body.roomId || !body.title || !Array.isArray(body.strokes)) {
      return c.json({ error: 'Missing fields' }, 400)
    }

    let skyViewKey: string | null = null
    if (body.skyViewImage) {
      skyViewKey = `sky/${crypto.randomUUID()}`
      await c.env.DRAWINGS_KV.put(skyViewKey, body.skyViewImage)
    }

    const result = await c.env.DB.prepare(`
      INSERT INTO constellations (room_id, title, story, sky_view_kv_key, strokes, creators)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      body.roomId,
      body.title.slice(0, 120),
      (body.story || '').slice(0, 2000),
      skyViewKey,
      JSON.stringify(body.strokes),
      JSON.stringify(body.creators || []),
    ).run()

    return c.json({ id: result.meta.last_row_id, skyViewKey })
  } catch (error) {
    console.error('Gallery save error:', error)
    return c.json({ error: 'Failed to save constellation' }, 500)
  }
})

app.get('/api/gallery', async (c) => {
  try {
    const sort = c.req.query('sort') === 'top' ? 'top' : 'new'
    const limit = Math.min(parseInt(c.req.query('limit') || '24', 10), 60)
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0)
    const orderClause = sort === 'top'
      ? 'ORDER BY like_count DESC, created_at DESC'
      : 'ORDER BY created_at DESC'

    const rows = await c.env.DB.prepare(`
      SELECT id, room_id, title, story, sky_view_kv_key, creators, like_count, created_at
      FROM constellations
      ${orderClause}
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all()

    const items = (rows.results || []).map((r: any) => ({
      id: r.id,
      roomId: r.room_id,
      title: r.title,
      story: r.story,
      hasSkyView: !!r.sky_view_kv_key,
      creators: safeJson(r.creators, []),
      likeCount: r.like_count,
      createdAt: r.created_at,
    }))
    return c.json({ items, nextOffset: offset + items.length })
  } catch (error) {
    console.error('Gallery list error:', error)
    return c.json({ error: 'Failed to list gallery' }, 500)
  }
})

app.get('/api/gallery/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) return c.json({ error: 'Bad id' }, 400)

    const row = await c.env.DB.prepare(`
      SELECT id, room_id, title, story, sky_view_kv_key, strokes, creators, like_count, created_at
      FROM constellations WHERE id = ?
    `).bind(id).first<any>()

    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({
      id: row.id,
      roomId: row.room_id,
      title: row.title,
      story: row.story,
      hasSkyView: !!row.sky_view_kv_key,
      strokes: safeJson(row.strokes, []),
      creators: safeJson(row.creators, []),
      likeCount: row.like_count,
      createdAt: row.created_at,
    })
  } catch (error) {
    console.error('Gallery get error:', error)
    return c.json({ error: 'Failed to fetch constellation' }, 500)
  }
})

app.get('/api/gallery/:id/image', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) return c.json({ error: 'Bad id' }, 400)
  const row = await c.env.DB.prepare(
    `SELECT sky_view_kv_key FROM constellations WHERE id = ?`
  ).bind(id).first<{ sky_view_kv_key: string | null }>()
  if (!row?.sky_view_kv_key) return c.json({ error: 'Not found' }, 404)
  const b64 = await c.env.DRAWINGS_KV.get(row.sky_view_kv_key)
  if (!b64) return c.json({ error: 'Image missing' }, 404)
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

app.post('/api/gallery/:id/like', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) return c.json({ error: 'Bad id' }, 400)
    const fp = await fingerprint(c.req.raw)

    const existing = await c.env.DB.prepare(
      `SELECT 1 FROM likes WHERE constellation_id = ? AND fingerprint = ?`
    ).bind(id, fp).first()

    if (existing) return c.json({ liked: true, alreadyLiked: true })

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO likes (constellation_id, fingerprint) VALUES (?, ?)`
      ).bind(id, fp),
      c.env.DB.prepare(
        `UPDATE constellations SET like_count = like_count + 1 WHERE id = ?`
      ).bind(id),
    ])

    const row = await c.env.DB.prepare(
      `SELECT like_count FROM constellations WHERE id = ?`
    ).bind(id).first<{ like_count: number }>()

    return c.json({ liked: true, likeCount: row?.like_count ?? 0 })
  } catch (error) {
    console.error('Like error:', error)
    return c.json({ error: 'Failed to like' }, 500)
  }
})

// --- Battles ----------------------------------------------------------------

const BATTLE_PROMPTS = [
  'a dragon soaring through the stars',
  'a ship sailing across the Milky Way',
  'a phoenix rising from a nebula',
  'a celestial archer drawing a bow',
  'twin guardians holding the heavens apart',
  'a crystal tree blooming in the void',
  'a leviathan coiled around a galaxy',
  'a wanderer with a lantern crossing the night',
  'a winged horse leaping between moons',
  'a labyrinth etched into the dark',
]

app.post('/api/battles', async (c) => {
  try {
    const body = await c.req.json<{ prompt?: string; durationSeconds?: number }>().catch(() => ({} as any))
    const prompt =
      (body.prompt && body.prompt.trim().slice(0, 160)) ||
      BATTLE_PROMPTS[Math.floor(Math.random() * BATTLE_PROMPTS.length)]
    const durationSeconds = Math.min(Math.max(body.durationSeconds || 180, 30), 600)
    const endsAt = new Date(Date.now() + durationSeconds * 1000).toISOString()

    const result = await c.env.DB.prepare(`
      INSERT INTO battles (prompt, status, duration_seconds, ends_at)
      VALUES (?, 'open', ?, ?)
    `).bind(prompt, durationSeconds, endsAt).run()

    return c.json({
      id: result.meta.last_row_id,
      prompt,
      durationSeconds,
      endsAt,
      status: 'open',
    })
  } catch (error) {
    console.error('Battle create error:', error)
    return c.json({ error: 'Failed to create battle' }, 500)
  }
})

app.get('/api/battles', async (c) => {
  try {
    const rows = await c.env.DB.prepare(`
      SELECT b.id, b.prompt, b.status, b.duration_seconds, b.started_at, b.ends_at,
             COUNT(e.id) as entry_count
      FROM battles b
      LEFT JOIN battle_entries e ON e.battle_id = b.id
      GROUP BY b.id
      ORDER BY b.started_at DESC
      LIMIT 30
    `).all()
    const now = Date.now()
    const items = (rows.results || []).map((r: any) => ({
      id: r.id,
      prompt: r.prompt,
      status: r.status,
      durationSeconds: r.duration_seconds,
      startedAt: r.started_at,
      endsAt: r.ends_at,
      entryCount: r.entry_count,
      timeRemaining: Math.max(0, Math.floor((Date.parse(r.ends_at) - now) / 1000)),
    }))
    return c.json({ items })
  } catch (error) {
    console.error('Battle list error:', error)
    return c.json({ error: 'Failed to list battles' }, 500)
  }
})

app.get('/api/battles/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) return c.json({ error: 'Bad id' }, 400)

    const battle = await c.env.DB.prepare(`
      SELECT id, prompt, status, duration_seconds, started_at, ends_at, winner_entry_id
      FROM battles WHERE id = ?
    `).bind(id).first<any>()
    if (!battle) return c.json({ error: 'Not found' }, 404)

    const entries = await c.env.DB.prepare(`
      SELECT id, room_id, team_name, score, feedback, submitted_at
      FROM battle_entries WHERE battle_id = ?
      ORDER BY score DESC, submitted_at ASC
    `).bind(id).all()

    // Auto-finalize once past end time.
    const now = Date.now()
    if (battle.status === 'open' && Date.parse(battle.ends_at) <= now) {
      const top = (entries.results || [])[0] as any
      const winnerId = top?.id ?? null
      await c.env.DB.prepare(
        `UPDATE battles SET status = 'complete', winner_entry_id = ? WHERE id = ?`
      ).bind(winnerId, id).run()
      battle.status = 'complete'
      battle.winner_entry_id = winnerId
    }

    return c.json({
      id: battle.id,
      prompt: battle.prompt,
      status: battle.status,
      durationSeconds: battle.duration_seconds,
      startedAt: battle.started_at,
      endsAt: battle.ends_at,
      winnerEntryId: battle.winner_entry_id,
      timeRemaining: Math.max(0, Math.floor((Date.parse(battle.ends_at) - now) / 1000)),
      entries: (entries.results || []).map((e: any) => ({
        id: e.id,
        roomId: e.room_id,
        teamName: e.team_name,
        score: e.score,
        feedback: e.feedback,
        submittedAt: e.submitted_at,
      })),
    })
  } catch (error) {
    console.error('Battle get error:', error)
    return c.json({ error: 'Failed to fetch battle' }, 500)
  }
})

app.get('/api/battles/:id/entries/:entryId/image', async (c) => {
  const entryId = parseInt(c.req.param('entryId'), 10)
  if (!Number.isFinite(entryId)) return c.json({ error: 'Bad id' }, 400)
  const row = await c.env.DB.prepare(
    `SELECT drawing_kv_key FROM battle_entries WHERE id = ?`
  ).bind(entryId).first<{ drawing_kv_key: string | null }>()
  if (!row?.drawing_kv_key) return c.json({ error: 'Not found' }, 404)
  const b64 = await c.env.DRAWINGS_KV.get(row.drawing_kv_key)
  if (!b64) return c.json({ error: 'Image missing' }, 404)
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

app.post('/api/battles/:id/submit', async (c) => {
  try {
    const battleId = parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(battleId)) return c.json({ error: 'Bad id' }, 400)

    const body = await c.req.json<{
      roomId: string
      teamName: string
      imageData: string
      strokes?: TimedLine[]
    }>()
    if (!body.roomId || !body.teamName || !body.imageData) {
      return c.json({ error: 'Missing fields' }, 400)
    }

    const battle = await c.env.DB.prepare(
      `SELECT id, prompt, ends_at, status FROM battles WHERE id = ?`
    ).bind(battleId).first<any>()
    if (!battle) return c.json({ error: 'Battle not found' }, 404)

    // Reject a second submission from the same room.
    const existing = await c.env.DB.prepare(
      `SELECT id FROM battle_entries WHERE battle_id = ? AND room_id = ?`
    ).bind(battleId, body.roomId).first()
    if (existing) return c.json({ error: 'Room already submitted' }, 409)

    const base64 = body.imageData.replace(/^data:image\/[a-z]+;base64,/, '')
    const imageBuffer = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))

    const judgePrompt = `You are judging a constellation drawing in a game. The prompt was: "${battle.prompt}".
Look at the drawing and respond in EXACTLY this format, no preamble:
SCORE: <integer from 0 to 100>
FEEDBACK: <one sentence on how well the drawing matches the prompt>`

    const judgeResponse = await c.env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
      image: [...imageBuffer],
      prompt: judgePrompt,
    })
    const { score, feedback } = parseBattleScore(extractAiText(judgeResponse))

    const kvKey = `battle/${battleId}/${crypto.randomUUID()}`
    await c.env.DRAWINGS_KV.put(kvKey, base64, { expirationTtl: 60 * 60 * 24 * 30 })

    const result = await c.env.DB.prepare(`
      INSERT INTO battle_entries (battle_id, room_id, team_name, drawing_kv_key, strokes, score, feedback)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      battleId,
      body.roomId,
      body.teamName.slice(0, 60),
      kvKey,
      body.strokes ? JSON.stringify(body.strokes) : null,
      score,
      feedback,
    ).run()

    return c.json({
      id: result.meta.last_row_id,
      score,
      feedback,
    })
  } catch (error) {
    console.error('Battle submit error:', error)
    return c.json({ error: 'Failed to submit entry' }, 500)
  }
})

app.get('/api/leaderboard', async (c) => {
  try {
    const rows = await c.env.DB.prepare(`
      SELECT team_name,
             COUNT(*) as battles_played,
             SUM(CASE WHEN b.winner_entry_id = e.id THEN 1 ELSE 0 END) as wins,
             AVG(e.score) as avg_score,
             MAX(e.score) as best_score
      FROM battle_entries e
      JOIN battles b ON b.id = e.battle_id
      GROUP BY team_name
      ORDER BY wins DESC, avg_score DESC
      LIMIT 20
    `).all()
    const items = (rows.results || []).map((r: any) => ({
      teamName: r.team_name,
      battlesPlayed: r.battles_played,
      wins: r.wins,
      avgScore: Math.round(r.avg_score || 0),
      bestScore: r.best_score,
    }))
    return c.json({ items })
  } catch (error) {
    console.error('Leaderboard error:', error)
    return c.json({ error: 'Failed to fetch leaderboard' }, 500)
  }
})

// --- Helpers for route bodies ------------------------------------------------

function safeJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// --- Static assets ----------------------------------------------------------

app.get('/', async (c) => c.env.ASSETS.fetch(c.req.raw))
app.get('/*', async (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
