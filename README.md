# Constellation Connect - NASA SpaceApps Challenge 2025

A collaborative constellation drawing game where multiple users can create star patterns together in real-time. Built for the NASA International SpaceApps Challenge.

## < Overview

Constellation Connect is an interactive web application that allows multiple users to collaboratively draw constellations in real-time. Perfect for hackathon demonstrations where audience members can join from their phones and contribute to a shared cosmic canvas.

## =� Features

- **Real-time Collaboration**: Multiple users can draw simultaneously using WebSockets and Cloudflare Durable Objects
- **Beautiful Space Theme**: Animated starfield background with gradient effects
- **AI Constellation Recognition**: Uses Cloudflare Workers AI to identify constellation patterns
- **Room-based Sessions**: Share a simple room code for others to join
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Color Palette**: Choose from 7 cosmic colors for drawing

## =� Tech Stack

- **Backend**: Hono framework on Cloudflare Workers
- **Frontend**: Vanilla HTML/CSS/JavaScript with Canvas API
- **Real-time**: Cloudflare Durable Objects for WebSocket handling
- **Database**: Cloudflare D1 for session tracking
- **Storage**: Cloudflare KV for caching analysis results
- **AI**: Cloudflare Workers AI for pattern recognition

## =� Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/constellation-connect.git
cd constellation-connect
```

2. Install dependencies:
```bash
npm install
```

3. Set up your Cloudflare account and create:
   - A D1 database
   - A KV namespace
   - Enable Durable Objects in your account

4. Update `wrangler.jsonc` with your IDs:
```json
{
  "env": {
    "d1_databases": [
      {
        "binding": "DB",
        "database_name": "your-database-name",
        "database_id": "your-database-id"
      }
    ],
    "kv_namespaces": [
      {
        "binding": "DRAWINGS_KV",
        "id": "your-kv-namespace-id"
      }
    ]
  }
}
```

5. Run database migrations:
```bash
wrangler d1 execute your-database-name --file=./schema.sql
```

## <�
B Development

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:8787`

## =� Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```

## <� How to Use

1. Open the application in your browser
2. Share the room URL with others to collaborate
3. Click and drag on the canvas to draw constellation patterns
4. Use the color palette to change drawing colors
5. Click "Find Constellation" to analyze the drawing with AI
6. Click "Clear Canvas" to start fresh

## <� Challenge Category

This project addresses the **"Explore Together"** challenge category, promoting collaborative exploration and discovery of space through shared artistic expression.

## =� API Endpoints

- `GET /api/room/:roomId/websocket` - WebSocket connection for real-time drawing
- `POST /api/analyze` - Analyze drawing for constellation patterns
- `GET /api/stats` - Get usage statistics
- `POST /api/session` - Record user session

## > Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## =� License

MIT License - feel free to use this project for your own hackathon submissions!

## =O Acknowledgments

Built with d for the NASA International SpaceApps Challenge 2025