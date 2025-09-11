import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  DRAWING_ROOM: DurableObjectNamespace
  DRAWINGS_KV: KVNamespace
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
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
          case 'join':
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
            break
            
          case 'draw_line':
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
            }
            break
            
          case 'clear':
            this.lines = []
            this.broadcast({
              type: 'canvas_cleared'
            })
            break
        }
      } catch (error) {
        console.error('Error handling message:', error)
      }
    })

    webSocket.addEventListener('close', () => {
      this.sessions.delete(webSocket)
      const participant = this.participants.get(userId)
      
      if (participant) {
        this.participants.delete(userId)
        
        // Notify others that the user left
        this.broadcast({
          type: 'user_left',
          userId
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
    headers: {
      'Upgrade': 'websocket',
    },
  }))
})

app.post('/api/analyze', async (c) => {
  try {
    const { imageData } = await c.req.json()
    
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
    };
    
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
    };
    
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
    ]);

    // Extract the description text from the response
    let detailedDescription = '';
    if (typeof detailResponse === 'object' && detailResponse.description) {
      detailedDescription = detailResponse.description;
    } else if (typeof detailResponse === 'string') {
      detailedDescription = detailResponse;
    } else {
      detailedDescription = 'A constellation pattern drawn in the night sky with bright stars connected by faint lines';
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
    ];
    
    const atmosphericEffects = [
      'ethereal mist and star fog',
      'shimmering stardust particles',
      'flowing cosmic rivers of light',
      'crystalline ice clouds catching starlight',
      'bioluminescent space clouds',
      'prismatic light refractions'
    ];
    
    const randomBackground = backgroundStyles[Math.floor(Math.random() * backgroundStyles.length)];
    const randomEffect = atmosphericEffects[Math.floor(Math.random() * atmosphericEffects.length)];
    
    // Generate sky view image with creative and varied backgrounds
    const imageGenerationPrompt = `Magical constellation art: Transform "${identificationResponse}" into a stunning constellation pattern. ${detailedDescription}. Background: ${randomBackground}. Atmosphere: ${randomEffect}. Bright twinkling stars connected by faint ethereal lines forming the shape, ${randomBackground}, dreamy and fantastical, highly artistic, varied and creative color palette, NOT plain blue sky, masterpiece quality`;

    const imageGenerationInput = {
      prompt: imageGenerationPrompt,
    };

    // Start image generation (but don't wait for it if we want to return faster)
    const skyViewPromise = c.env.AI.run(
      "@cf/leonardo/lucid-origin" as any,
      imageGenerationInput
    );

    // We can return the identification immediately and let the image generate
    const skyViewResponse = await skyViewPromise;

    // Store the analysis
    await c.env.DRAWINGS_KV.put(`analysis_${Date.now()}`, JSON.stringify({
      identification: identificationResponse,
      skyView: skyViewResponse,
      timestamp: Date.now()
    }), { expirationTtl: 86400 })

    return c.json({ 
      result: identificationResponse,
      skyView: skyViewResponse,
      backgroundStyle: randomBackground 
    })
  } catch (error) {
    console.error('Analysis error:', error)
    return c.json({ error: 'Analysis failed' }, 500)
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
      timestamp: Date.now()
    })
  } catch (error) {
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