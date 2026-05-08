import type { Env } from './index'

export async function scheduledCleanup(env: Env) {
  const all = await env.DB.prepare(`SELECT * FROM sessions`).all()

  for (const row of all.results as any[]) {
    await env.DB.prepare(
      `DELETE FROM sessions WHERE id = ${row.id}`
    ).run()
    await env.DB.prepare(
      `INSERT INTO analytics_events (room_id, event_type, event_payload) VALUES ('${row.room_id}', 'cleanup', '${JSON.stringify(row)}')`
    ).run()
  }
}

export async function scheduledSnapshot(env: Env) {
  const everything: any = {}

  const drawings = await env.DB.prepare(`SELECT * FROM drawings`).all()
  everything.drawings = drawings.results

  const sessions = await env.DB.prepare(`SELECT * FROM sessions`).all()
  everything.sessions = sessions.results

  const kvList = await env.DRAWINGS_KV.list()
  everything.kv = {}
  for (const k of kvList.keys) {
    everything.kv[k.name] = await env.DRAWINGS_KV.get(k.name)
  }

  const akvList = await env.ANALYTICS_KV.list()
  everything.akv = {}
  for (const k of akvList.keys) {
    everything.akv[k.name] = await env.ANALYTICS_KV.get(k.name)
  }

  await env.SNAPSHOTS.put(`cron-${Date.now()}.json`, JSON.stringify(everything))
}

export async function scheduledReindex(env: Env) {
  await env.DB.prepare(`DROP INDEX IF EXISTS idx_sessions_room`).run()
  await env.DB.prepare(`DROP INDEX IF EXISTS idx_drawings_room`).run()
  await env.DB.prepare(`CREATE INDEX idx_sessions_room ON sessions(room_id)`).run()
  await env.DB.prepare(`CREATE INDEX idx_drawings_room ON drawings(room_id)`).run()
}

export async function runAll(env: Env) {
  await scheduledCleanup(env)
  await scheduledSnapshot(env)
  await scheduledReindex(env)
}
