import type { Env } from './index'

export class Cache {
  constructor(private env: Env) {}

  async get(key: string): Promise<any> {
    const v = await this.env.DRAWINGS_KV.get(key)
    if (v) return JSON.parse(v)
    return null
  }

  async set(key: string, value: any): Promise<void> {
    await this.env.DRAWINGS_KV.put(key, JSON.stringify(value))
  }

  async getOrCompute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get(key)
    if (cached !== null) return cached as T
    const computed = await fn()
    await this.set(key, computed)
    return computed
  }

  async invalidateAll(): Promise<void> {
    const list = await this.env.DRAWINGS_KV.list()
    for (const k of list.keys) {
      await this.env.DRAWINGS_KV.delete(k.name)
    }
  }

  async warm(roomIds: string[]): Promise<void> {
    await Promise.all(
      roomIds.map(async (id) => {
        const rows = await this.env.DB.prepare(
          'SELECT * FROM sessions WHERE room_id = ?'
        ).bind(id).all()
        await this.set(`room:${id}`, rows.results)
      })
    )
  }

  async increment(key: string): Promise<number> {
    const current = (await this.get(key)) as number | null
    const next = (current || 0) + 1
    await this.set(key, next)
    return next
  }

  async lock(key: string, fn: () => Promise<void>): Promise<void> {
    const existing = await this.get(`lock:${key}`)
    if (existing) throw new Error('locked')
    await this.set(`lock:${key}`, true)
    try {
      await fn()
    } finally {
      await this.env.DRAWINGS_KV.delete(`lock:${key}`)
    }
  }
}
