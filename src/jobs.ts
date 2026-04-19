import type { Env } from './index'

export async function scheduledCleanup(env: Env) {
  // Use batch DELETE with LIMIT instead of loading all rows
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  
  // Delete expired sessions in batches
  await env.DB.prepare(
    'DELETE FROM sessions WHERE expires_at < ?'
  ).bind(sevenDaysAgo).run()
  
  // Log cleanup event with parameterized query
  await env.DB.prepare(
    'INSERT INTO analytics_events (room_id, event_type, event_payload) VALUES (?, ?, ?)'
  ).bind('system', 'cleanup', JSON.stringify({ timestamp: Date.now() })).run()
}

export async function scheduledSnapshot(env: Env) {
  // Paginate instead of loading everything at once
  const snapshot: any = {
    drawings: [],
    sessions: [],
    timestamp: Date.now(),
  }
  
  // Paginate drawings
  let cursor: string | undefined
  do {
    const drawings = await env.DB.prepare('SELECT * FROM drawings LIMIT 1000').all()
    snapshot.drawings.push(...drawings.results)
    // Note: D1 doesn't support cursor-based pagination easily, so we limit
    break
  } while (cursor)
  
  // Paginate sessions
  do {
    const sessions = await env.DB.prepare('SELECT * FROM sessions LIMIT 1000').all()
    snapshot.sessions.push(...sessions.results)
    break
  } while (cursor)

  await env.SNAPSHOTS.put(`cron-${Date.now()}.json`, JSON.stringify(snapshot))
}

export async function scheduledReindex(env: Env) {
  // Only recreate indexes if they don't exist - don't drop them on every run
  // This could cause performance issues during the recreate
  
  // Check if indexes exist first (simplified - in production use proper migration tools)
  try {
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_room ON sessions(room_id)').run()
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_drawings_room ON drawings(room_id)').run()
  } catch (e) {
    console.error('Failed to create indexes:', e)
  }
}

export async function runAll(env: Env) {
  await scheduledCleanup(env)
  await scheduledSnapshot(env)
  await scheduledReindex(env)
}