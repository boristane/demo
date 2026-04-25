import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createLogger, WideEventBuilder, Logger } from './logger'
import { wideEventLogger } from './middleware/logger'
import type { Variables } from './types'

export interface Env {
  DRAWING_ROOM: DurableObjectNamespace
  DRAWINGS_KV: KVNamespace
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  STAGE: string
}

interface DrawingMessage {
  type: 'join' | 'draw_line' | 'clear' | 'user_joined' | 'user_left' | 'line_drawn' | 'canvas_cleared' | 'init' | 'constellation_found'
  userId?: string
  name?: string
  color?: string
  from?: Point
  to?: Point
  participants?: Array<[string, Participant]>
  lines?: Line[]
  result?: string
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
  '#e91e63', // Pink
  '#9c27b0', // Purple
  '#673ab7', // Deep Purple
  '#3f51b5', // Indigo
  '#2196f3', // Blue
  '#00bcd4', // Cyan
  '#009688', // Teal
  '#4caf50', // Green
  '#8bc34a', // Light Green
  '#ff9800', // Orange
  '#ff5722', // Deep Orange
  '#795548', // Brown
]

export class DrawingRoom {
  private sessions: Map<WebSocket, string> = new Map()
  private participants: Map<string, Participant> = new Map()
  private lines: Line[] = []
  private colorIndex: number = 0
  private logger: Logger

  constructor(state: unknown, env: Env) {
    this.logger = new Logger({
      service: 'constellation-connect',
      version: '0.0.0',
      environment: env.STAGE || 'development',
      region: 'auto',
    })
  }

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
    const sessionStartTime = Date.now()
    this.sessions.set(webSocket, userId)

    // Log session start with wide event pattern
    this.logger.info({
      event_type: 'websocket_session_start',
      user_id: userId,
      session_start_time: new Date().toISOString(),
      active_sessions: this.sessions.size,
      active_participants: this.participants.size,
    })

    webSocket.addEventListener('message', async (event) => {
      const messageStartTime = Date.now()
      
      try {
        const message = JSON.parse(event.data as string)
        
        switch (message.type) {
          case 'join': {
            // Assign a color to the new user
            const color = COLORS[this.colorIndex % COLORS.length]
            this.colorIndex++
            
            // Store participant info
            this.participants.set(userId, {
              name: message.name || 'Anonymous',
              color: color
            })
            
            // Send init message to the joining user
            webSocket.send(JSON.stringify({
              type: 'init',
              userId,
              color,
              participants: Array.from(this.participants.entries()),
              lines: this.lines
            }))
            
            // Notify others about the new user
            this.broadcast({
              type: 'user_joined',
              userId,
              name: message.name,
              color
            }, webSocket)

            // Log user join event with business context
            this.logger.info({
              event_type: 'websocket_user_join',
              user_id: userId,
              user_name: message.name || 'Anonymous',
              user_color: color,
              participant_count: this.participants.size,
              message_handling_ms: Date.now() - messageStartTime,
            })
            break
          }
            
          case 'draw_line': {
            const participant = this.participants.get(userId)
            if (participant) {
              const line: Line = {
                from: message.from,
                to: message.to,
                userId,
                color: participant.color
              }
              this.lines.push(line)
              
              // Keep only last 1000 lines
              if (this.lines.length > 1000) {
                this.lines = this.lines.slice(-500)
              }
              
              // Broadcast the line to all users
              this.broadcast({
                type: 'line_drawn',
                from: message.from,
                to: message.to,
                color: participant.color,
                userId
              })

              // Log draw event with context
              this.logger.info({
                event_type: 'websocket_draw_line',
                user_id: userId,
                user_name: participant.name,
                total_lines: this.lines.length,
                message_handling_ms: Date.now() - messageStartTime,
              })
            }
            break
          }
            
          case 'clear': {
            this.lines = []
            this.broadcast({
              type: 'canvas_cleared'
            })

            // Log clear event
            this.logger.info({
              event_type: 'websocket_clear_canvas',
              user_id: userId,
              participant_count: this.participants.size,
              message_handling_ms: Date.now() - messageStartTime,
            })
            break
          }
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        
        // Structured error logging with context
        this.logger.error({
          event_type: 'websocket_message_error',
          user_id: userId,
          error_type: err.name,
          error_message: err.message,
          message_handling_ms: Date.now() - messageStartTime,
        })
      }
    })

    webSocket.addEventListener('close', () => {
      this.sessions.delete(webSocket)
      const participant = this.participants.get(userId)
      const sessionDurationMs = Date.now() - sessionStartTime
      
      if (participant) {
        this.participants.delete(userId)
        
        // Notify others that the user left
        this.broadcast({
          type: 'user_left',
          userId
        })

        // Log session end with business context
        this.logger.info({
          event_type: 'websocket_session_end',
          user_id: userId,
          user_name: participant.name,
          session_duration_ms: sessionDurationMs,
          remaining_participants: this.participants.size,
          lines_drawn_by_user: this.lines.filter(l => l.userId === userId).length,
        })
      }
    })
  }

  broadcast(message: DrawingMessage, exclude?: WebSocket) {
    const messageStr = JSON.stringify(message)
    
    this.sessions.forEach((_, ws) => {
      if (ws !== exclude && ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(messageStr)
      }
    })
  }
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Apply wide event logging middleware
app.use(wideEventLogger())

app.get('/api/room/:roomId/websocket', async (c) => {
  const roomId = c.req.param('roomId')
  const requestId = c.get('requestId')
  const id = c.env.DRAWING_ROOM.idFromName(roomId)
  const room = c.env.DRAWING_ROOM.get(id)
  
  // Log WebSocket upgrade attempt
  const logger = createLogger(c)
  logger.info({
    event_type: 'websocket_upgrade',
    room_id: roomId,
    request_id: requestId,
  })
  
  return room.fetch(new Request('http://fake-host/websocket', {
    headers: {
      'Upgrade': 'websocket',
    },
  }))
})

app.post('/api/analyze', async (c) => {
  const logger = createLogger(c)
  const requestId = c.get('requestId')
  const wideEvent = new WideEventBuilder(logger, {
    requestId,
    method: 'POST',
    path: '/api/analyze',
  })
  
  try {
    const { imageData } = await c.req.json()
    
    // Add business context
    wideEvent.add({
      event_type: 'analyze_request',
      has_image_data: !!imageData,
      image_data_length: imageData?.length,
    })
    
    // Remove the data:image/png;base64, prefix if present
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '')
    
    // Convert base64 to array buffer
    const imageBuffer = Uint8Array.from(atob(base64Data), char => char.charCodeAt(0))

    // First analysis - identify what the drawing represents and create a story
    const identificationPrompt = `
Analyze this hand-drawn image and transform it into a realistic NASA constellation story:

1. **Shape Recognition**: What shape or pattern do you see in this drawing?
2. **Constellation Name**: Give it a creative, space-inspired name
3. **Mythological Story**: Create a brief, story about this constellation (2-3 sentences)
4. **Key Stars**: Identify the brightest stars and what they represent in your story
5. **Special Features**: Note any unique patterns or clusters that make this constellation special

Be imaginative and poetic - every drawing tells a celestial story!
`

    // Prepare both analysis inputs
    const identificationInput = {
      image: [...imageBuffer],
      prompt: identificationPrompt,
    }
    
    // Second analysis - describe the drawing pattern for visualization
    const detailPrompt = `Describe this drawing's star pattern in detail for creating a beautiful night sky scene:

- Where are the main stars/points located (upper, middle, lower regions)?
- How are they connected (straight lines, curves, clusters)?
- What's the overall shape and flow of the pattern?
- Which areas should have bright stars vs dim ones?
- Any special features like star clusters or empty spaces?

Focus on the actual drawing pattern, not interpretation.`

    const detailInput = {
      image: [...imageBuffer],
      prompt: detailPrompt,
    }
    
    const aiStartTime = Date.now()
    
    // Run all three AI calls in parallel for maximum speed
    const [identificationResponse, detailResponse] = await Promise.all([
      c.env.AI.run(
        "@cf/llava-hf/llava-1.5-7b-hf",
        identificationInput
      ),
      c.env.AI.run(
        "@cf/llava-hf/llava-1.5-7b-hf",
        detailInput
      )
    ])
    
    const aiLatencyMs = Date.now() - aiStartTime

    // Extract the description text from the response
    let detailedDescription = ''
    if (typeof detailResponse === 'object' && detailResponse.description) {
      detailedDescription = detailResponse.description
    } else if (typeof detailResponse === 'string') {
      detailedDescription = detailResponse
    } else {
      detailedDescription = 'A constellation pattern drawn in the night sky with bright stars connected by faint lines'
    }

    // Randomly select creative background elements for variety
    const backgroundStyles = [
      'aurora borealis green and purple dancing lights',
      'deep purple and pink nebula clouds swirling',
      'sunset orange and red twilight sky transitioning to night',
      'teal and cyan cosmic dust with distant galaxies',
      'rose gold dawn sky with morning stars',
      'indigo midnight with silver moonlight',
      'emerald and sapphire cosmic ocean',
      'crimson and gold stellar nursery'
    ]
    
    const atmosphericEffects = [
      'ethereal mist and star fog',
      'shimmering stardust particles',
      'flowing cosmic rivers of light',
      'crystalline ice clouds catching starlight',
      'bioluminescent space clouds',
      'prismatic light refractions'
    ]
    
    const randomBackground = backgroundStyles[Math.floor(Math.random() * backgroundStyles.length)]
    const randomEffect = atmosphericEffects[Math.floor(Math.random() * atmosphericEffects.length)]
    
    // Generate sky view image with creative and varied backgrounds
    const imageGenerationPrompt = `Magical constellation art: Transform "${identificationResponse}" into a stunning constellation pattern. ${detailedDescription}. Background: ${randomBackground}. Atmosphere: ${randomEffect}. Bright twinkling stars connected by faint ethereal lines forming the shape, ${randomBackground}, dreamy and fantastical, highly artistic, varied and creative color palette, NOT plain blue sky, masterpiece quality`

    const imageGenerationInput = {
      prompt: imageGenerationPrompt,
    }

    // Start image generation
    const skyViewStartTime = Date.now()
    const skyViewResponse = await c.env.AI.run(
      "@cf/leonardo/lucid-origin" as any,
      imageGenerationInput
    )
    const skyViewLatencyMs = Date.now() - skyViewStartTime

    const kvStartTime = Date.now()
    
    // Store the analysis
    await c.env.DRAWINGS_KV.put(`analysis_${Date.now()}`, JSON.stringify({
      identification: identificationResponse,
      skyView: skyViewResponse,
      timestamp: Date.now()
    }), { expirationTtl: 86400 })
    
    const kvLatencyMs = Date.now() - kvStartTime

    // Add outcome context before completing
    wideEvent.add({
      ai_latency_ms: aiLatencyMs,
      skyview_latency_ms: skyViewLatencyMs,
      kv_latency_ms: kvLatencyMs,
      background_style: randomBackground,
    })

    wideEvent.complete(200, 'success')
    
    return c.json({ 
      result: identificationResponse,
      skyView: skyViewResponse,
      backgroundStyle: randomBackground 
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    // Structured error logging with full context
    wideEvent.completeWithError(500, err)
    
    return c.json({ error: 'Analysis failed' }, 500)
  }
})

app.post('/api/session', async (c) => {
  const logger = createLogger(c)
  const requestId = c.get('requestId')
  const wideEvent = new WideEventBuilder(logger, {
    requestId,
    method: 'POST',
    path: '/api/session',
  })
  
  try {
    const { roomId, userId } = await c.req.json()
    
    // Add business context early
    wideEvent.add({
      event_type: 'create_session',
      room_id: roomId,
      user_id: userId,
    })
    
    await c.env.DB.prepare(`
      INSERT INTO sessions (room_id, user_id, created_at)
      VALUES (?, ?, datetime('now'))
    `).bind(roomId, userId).run()

    wideEvent.complete(200, 'success')
    
    return c.json({ success: true })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    wideEvent.completeWithError(500, err)
    
    return c.json({ error: 'Failed to create session' }, 500)
  }
})

app.get('/api/stats', async (c) => {
  const logger = createLogger(c)
  const requestId = c.get('requestId')
  const wideEvent = new WideEventBuilder(logger, {
    requestId,
    method: 'GET',
    path: '/api/stats',
  })
  
  try {
    const result = await c.env.DB.prepare(`
      SELECT COUNT(*) as total_sessions,
             COUNT(DISTINCT room_id) as unique_rooms
      FROM sessions
      WHERE created_at > datetime('now', '-24 hours')
    `).first()
    
    const stats = {
      totalSessions: result?.total_sessions || 0,
      uniqueRooms: result?.unique_rooms || 0,
      timestamp: Date.now()
    }

    // Add business context
    wideEvent.add({
      event_type: 'get_stats',
      total_sessions_24h: stats.totalSessions,
      unique_rooms_24h: stats.uniqueRooms,
    })

    wideEvent.complete(200, 'success')
    
    return c.json(stats)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    wideEvent.completeWithError(500, err)
    
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
})

app.get('/', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw)
})

app.get('/*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw)
})

export default app
