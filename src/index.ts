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

interface Participant {
  name: string
  color: string
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

// 20 daily prompts, rotated by day-of-year.
const DAILY_PROMPTS = [
  'Draw a dragon flying across the sky',
  'Draw a whale swimming through stars',
  'Draw a hero wielding a sword',
  'Draw a castle on a distant cloud',
  'Draw a phoenix rising from embers',
  'Draw the tree of life',
  'Draw a heart made of starlight',
  'Draw a ship sailing the cosmos',
  'Draw a crown of seven stars',
  'Draw a snake coiled in the heavens',
  'Draw a butterfly crossing the galaxy',
  'Draw a compass rose',
  'Draw an owl watching the night',
  'Draw a spiral galaxy',
  'Draw a crescent moon with a face',
  'Draw a stargazer looking up',
  'Draw a wolf howling at the stars',
  'Draw an infinity symbol',
  'Draw a key to the heavens',
  'Draw a lighthouse at the edge of space',
]

function dayOfYearUTC(): number {
  const now = new Date()
  const start = Date.UTC(now.getUTCFullYear(), 0, 0)
  const diff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start
  return Math.floor(diff / 86400000)
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

export class DrawingRoom {
  private sessions: Map<WebSocket, string> = new Map()
  private participants: Map<string, Participant> = new Map()
  private cursors: Map<string, { x: number; y: number; t: number }> = new Map()
  private lines: Line[] = []
  private colorIndex: number = 0
  private lastReactionAt: Map<string, number> = new Map()

  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === '/websocket') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 400 })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      await this.handleSession(server)

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    return new Response('Not found', { status: 404 })
  }

  async handleSession(webSocket: WebSocket) {
    webSocket.accept()

    const userId = crypto.randomUUID()
    this.sessions.set(webSocket, userId)

    webSocket.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data as string)

        switch (message.type) {
          case 'join': {
            const color = COLORS[this.colorIndex % COLORS.length]
            this.colorIndex++

            this.participants.set(userId, {
              name: (message.name || 'Anonymous').slice(0, 24),
              color,
            })

            webSocket.send(JSON.stringify({
              type: 'init',
              userId,
              color,
              participants: Array.from(this.participants.entries()),
              lines: this.lines,
            }))

            this.broadcast({
              type: 'user_joined',
              userId,
              name: message.name,
              color,
            }, webSocket)
            break
          }

          case 'draw_line': {
            const participant = this.participants.get(userId)
            if (!participant) break
            const line: Line = {
              from: message.from,
              to: message.to,
              userId,
              color: participant.color,
            }
            this.lines.push(line)
            if (this.lines.length > 1000) {
              this.lines = this.lines.slice(-500)
            }
            this.broadcast({
              type: 'line_drawn',
              from: message.from,
              to: message.to,
              color: participant.color,
              userId,
            })
            break
          }

          case 'clear':
            this.lines = []
            this.broadcast({ type: 'canvas_cleared' })
            break

          case 'cursor_move': {
            const participant = this.participants.get(userId)
            if (!participant) break
            this.cursors.set(userId, { x: message.x, y: message.y, t: Date.now() })
            this.broadcast({
              type: 'cursor_update',
              userId,
              x: message.x,
              y: message.y,
              color: participant.color,
              name: participant.name,
            }, webSocket)
            break
          }

          case 'cursor_leave': {
            this.cursors.delete(userId)
            this.broadcast({ type: 'cursor_gone', userId }, webSocket)
            break
          }

          case 'reaction': {
            const last = this.lastReactionAt.get(userId) || 0
            if (Date.now() - last < 300) break
            this.lastReactionAt.set(userId, Date.now())
            const allowed = ['✨', '🌟', '💫', '⭐', '❤️', '🔥']
            if (!allowed.includes(message.emoji)) break
            this.broadcast({
              type: 'reaction_sent',
              emoji: message.emoji,
              x: message.x,
              y: message.y,
              userId,
            })
            break
          }

          case 'constellation_saved': {
            this.broadcast({
              type: 'constellation_saved',
              id: message.id,
              name: message.name,
              by: this.participants.get(userId)?.name,
            }, webSocket)
            break
          }
        }
      } catch (error) {
        console.error('Error handling message:', error)
      }
    })

    webSocket.addEventListener('close', () => {
      this.sessions.delete(webSocket)
      this.cursors.delete(userId)
      const participant = this.participants.get(userId)
      if (participant) {
        this.participants.delete(userId)
        this.broadcast({ type: 'user_left', userId })
        this.broadcast({ type: 'cursor_gone', userId })
      }
    })
  }

  broadcast(message: Record<string, unknown>, exclude?: WebSocket) {
    const messageStr = JSON.stringify(message)
    this.sessions.forEach((_, ws) => {
      if (ws !== exclude && ws.readyState === WebSocket.READY_STATE_OPEN) {
        try { ws.send(messageStr) } catch {}
      }
    })
  }
}

const app = new Hono<{ Bindings: Env }>()

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/api/room/:roomId/websocket', async (c) => {
  const roomId = c.req.param('roomId')
  const id = c.env.DRAWING_ROOM.idFromName(roomId)
  const room = c.env.DRAWING_ROOM.get(id)

  return room.fetch(new Request('http://fake-host/websocket', {
    headers: { 'Upgrade': 'websocket' },
  }))
})

app.get('/api/daily-prompt', async (c) => {
  const day = todayUTC()
  const prompt = DAILY_PROMPTS[dayOfYearUTC() % DAILY_PROMPTS.length]
  return c.json({ date: day, prompt })
})

function extractText(resp: unknown): string {
  if (!resp) return ''
  if (typeof resp === 'string') return resp
  if (typeof resp === 'object') {
    const r = resp as Record<string, unknown>
    if (typeof r.response === 'string') return r.response
    if (typeof r.description === 'string') return r.description
    if (typeof r.text === 'string') return r.text
    const firstStr = Object.values(r).find((v) => typeof v === 'string')
    if (typeof firstStr === 'string') return firstStr
  }
  return ''
}

function parseNameAndStory(raw: string): { name: string; story: string } {
  const nameMatch = raw.match(/NAME:\s*(.+?)(?:\n|$)/i)
  const storyMatch = raw.match(/STORY:\s*([\s\S]+?)(?:\n\s*[A-Z][A-Z ]+:|$)/i)
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : ''
  const story = storyMatch ? storyMatch[1].trim() : ''
  if (name && story) return { name, story }
  const fallbackName = raw.split(/[\n.]/)[0].slice(0, 60).trim() || 'The Unnamed One'
  const fallbackStory = raw.trim().slice(0, 600)
  return {
    name: name || fallbackName,
    story: story || fallbackStory,
  }
}

app.post('/api/analyze', async (c) => {
  try {
    const { imageData } = await c.req.json<{ imageData: string }>()

    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '')
    const imageBuffer = Uint8Array.from(atob(base64Data), (ch) => ch.charCodeAt(0))

    const identificationPrompt = `You are an ancient sky-lore storyteller. Look at this hand-drawn constellation and respond in EXACTLY this format:

NAME: <a creative 2-4 word constellation name>
STORY: <a short myth in the style of ancient legend, 2-3 sentences, poetic and evocative>

Do not include any other text.`

    const detailPrompt = `Describe this drawing's star pattern for a night-sky illustration: where the main stars sit, how they connect, the overall shape and flow. Keep it short.`

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

    const identificationText = extractText(identificationResponse)
    const { name, story } = parseNameAndStory(identificationText)
    const detailedDescription = extractText(detailResponse) ||
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

    const imageGenerationPrompt = `Magical constellation art: "${name}". ${detailedDescription}. Background: ${randomBackground}. Atmosphere: ${randomEffect}. Bright twinkling stars connected by faint ethereal lines forming the shape, dreamy and fantastical, varied and creative color palette, masterpiece quality`

    const skyViewResponse = await c.env.AI.run(
      '@cf/leonardo/lucid-origin' as never,
      { prompt: imageGenerationPrompt } as never,
    )

    return c.json({
      name,
      story,
      result: identificationText,
      skyView: skyViewResponse,
      backgroundStyle: randomBackground,
    })
  } catch (error) {
    console.error('Analysis error:', error)
    return c.json({ error: 'Analysis failed' }, 500)
  }
})

app.post('/api/constellation', async (c) => {
  try {
    const body = await c.req.json<{
      roomId: string
      name: string
      story?: string
      author?: string
      image?: string
    }>()

    const name = (body.name || '').trim().slice(0, 60)
    if (!name) return c.json({ error: 'Name required' }, 400)

    const id = crypto.randomUUID()
    const story = (body.story || '').trim().slice(0, 2000)
    const author = (body.author || '').trim().slice(0, 24) || 'Anonymous'
    const hasImage = body.image ? 1 : 0

    await c.env.DB.prepare(`
      INSERT INTO constellations (id, room_id, name, story, author, has_image)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, body.roomId || 'unknown', name, story, author, hasImage).run()

    if (body.image) {
      await c.env.DRAWINGS_KV.put(`constellation_image_${id}`, body.image)
    }

    return c.json({ id, name, story, author })
  } catch (error) {
    console.error('Save error:', error)
    return c.json({ error: 'Failed to save constellation' }, 500)
  }
})

app.get('/api/gallery', async (c) => {
  try {
    const limit = Math.min(Number(c.req.query('limit') || 48), 100)
    const result = await c.env.DB.prepare(`
      SELECT id, name, story, author, has_image, created_at
      FROM constellations
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all()

    return c.json({ items: result.results ?? [] })
  } catch (error) {
    console.error('Gallery error:', error)
    return c.json({ error: 'Failed to fetch gallery' }, 500)
  }
})

app.get('/api/gallery/:id/image', async (c) => {
  try {
    const id = c.req.param('id')
    const image = await c.env.DRAWINGS_KV.get(`constellation_image_${id}`)
    if (!image) return c.json({ error: 'Not found' }, 404)
    return c.json({ image })
  } catch (error) {
    return c.json({ error: 'Failed to fetch image' }, 500)
  }
})

app.post('/api/session', async (c) => {
  try {
    const { roomId, userId } = await c.req.json()
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

app.get('/', async (c) => c.env.ASSETS.fetch(c.req.raw))
app.get('/*', async (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
