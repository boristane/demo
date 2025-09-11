Build a web application for the NASA International SpaceApps Challenge with the following architecture and requirements:

## Tech Stack & Structure
- Backend: Hono framework on Cloudflare Workers (./src/index.ts)
- Frontend: Static HTML/CSS/JavaScript files in ./public folder (no frameworks - vanilla only)
- Database: Cloudflare D1 for relational data
- Storage: Cloudflare KV for key-value caching
- AI: Cloudflare Workers AI for ML capabilities
- Durable Objects: Cloudflare Durable Objects for real-time

## Core Features (prioritize these)
1. [List 3-4 essential features that directly address the challenge]
2. [Be specific about functionality needed]
3. [Include any data processing or visualization requirements]

## Technical Requirements
- Implement proper error handling and input validation
- Use environment variables for API keys and sensitive config
- Include CORS headers for API endpoints
- Implement rate limiting for API calls
- Add proper TypeScript types throughout
- Include database migrations for D1 schema
- Cache frequently accessed data in KV

## Code Quality Standards
- Write clean, well-commented code
- Follow REST API best practices
- Implement proper separation of concerns
- Include basic security measures (input sanitization, etc.)
- Make the frontend responsive and accessible
- Add loading states and error messages for better UX

## Project Setup
- Include a comprehensive README with setup instructions
- Add a wrangler.toml configuration file
- Include package.json with all dependencies
- Provide sample .env.example file
- Add database schema and seed data if applicable

## Testing Approach
- Include at least basic API endpoint tests
- Add example API calls in comments
- Verify all critical paths work before finalizing

Please build this application step by step, testing each component as you go. Start with the basic structure, then add features incrementally. Focus on reliability and completeness over complexity.

---

**Hackathon Project Style & Preferences:**

I prefer building simple, elegant web applications with a focus on exceptional UI/UX design that would appeal to a senior designer. Keep the application extremely simple. It must do a single thing. I don't want any complex dashboard or any complex map.

My ideal hackathon projects are:

**Technical Stack:**
- Frontend: Clean HTML/CSS/JavaScript (no complex frameworks)
- Backend: Hono framework on Cloudflare Workers
- Storage: Cloudflare Durable Objects when persistence is needed
- AI: Cloudflare Workers AI for intelligent features
- Real-time and Collaboration: Cloudflare Durable Object for real-time collaboration.

**Project Characteristics:**
- **Scope**: Simple, finished, and polished rather than ambitious but incomplete
- **Domains**: Collaboration tools, productivity applications, or data analytics dashboards
- **Audience**: Technical users and power users who appreciate well-crafted tools
- **Approach**: Build new concepts from scratch rather than iterating on existing ideas

**Design Philosophy:**
- UI/UX polish is the highest priority - functionality should be clean and intuitive
- Prioritize quality over quantity of features
- Create applications that demonstrate thoughtful design decisions
- Focus on user experience that feels professional and refined

**Motivation**: I'm driven primarily by curiosity and the joy of exploring interesting problems through well-designed solutions. I want to create tools that technical users would genuinely want to use because they're both functional and beautifully crafted.

When suggesting hackathon projects, prioritize ideas that can be elegantly executed within time constraints while showcasing exceptional design and user experience. I want a small project that does a single thing. It must be like a game that multiple people in the audience can open on their phone and have a playful experience.
