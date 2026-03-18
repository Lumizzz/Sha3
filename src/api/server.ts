import express from 'express'
import cors from 'cors'
import { json } from 'express'
import jwt from 'jsonwebtoken'
import type { HarmoniaClient } from '../client'
import { logger } from '../utils/logger'
import { prisma } from '../lib/db'

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; reset: number }>()
function rateLimit(max: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip ?? 'unknown'
    const now = Date.now()
    const entry = rateLimitMap.get(key)
    if (!entry || now > entry.reset) {
      rateLimitMap.set(key, { count: 1, reset: now + windowMs })
      return next()
    }
    entry.count++
    if (entry.count > max) return res.status(429).json({ error: 'Too many requests' })
    next()
  }
}

const SECRET = process.env.BOT_API_SECRET ?? 'change-me'

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try { jwt.verify(header.slice(7), SECRET); next() }
  catch { return res.status(403).json({ error: 'Forbidden' }) }
}

export async function startApiServer(client: HarmoniaClient) {
  const app = express()
  app.use(cors({ origin: process.env.DASHBOARD_URL ?? '*' })); app.use(json()); app.use(rateLimit(60, 60_000))

  // Health — no auth
  app.get('/health', (_, res) => res.json({
    status: 'ok', uptime: Date.now() - client.startTime,
    guilds: client.guilds.cache.size, players: client.kazagumo.players.size, ping: client.ws.ping,
  }))

  app.use(auth)

  // ── Player state ──────────────────────────────────────────────────────────
  app.get('/player/:guildId', async (req, res) => {
    try {
      const cached = await client.redis.get(`player:${req.params.guildId}`)
      if (cached) return res.json(JSON.parse(cached))
      const player = client.musicService.getPlayer(req.params.guildId)
      if (!player) return res.json({ isPlaying: false })
      await client.musicService.publishPlayerState(req.params.guildId, player)
      const fresh = await client.redis.get(`player:${req.params.guildId}`)
      return res.json(fresh ? JSON.parse(fresh) : { isPlaying: false })
    } catch (err) { logger.error({ err }, 'GET /player error'); res.status(500).json({ error: 'Internal error' }) }
  })

  // ── Player control ────────────────────────────────────────────────────────
  app.post('/player/:guildId/control', async (req, res) => {
    const { action, value } = req.body
    const player = client.musicService.getPlayer(req.params.guildId)
    if (!player) return res.status(404).json({ error: 'No active player' })
    try {
      switch (action) {
        case 'pause':    await player.pause(true); break
        case 'resume':   await player.pause(false); break
        case 'skip':     await player.skip(); break
        case 'stop':     player.queue.clear(); await player.skip(); break
        case 'volume':   await player.setVolume(Math.max(1, Math.min(150, Number(value)))); break
        case 'loop':     player.setLoop(value as 'none'|'track'|'queue'); break
        case 'shuffle':  player.queue.shuffle(); break
        case 'seek':     await player.shoukaku.seekTo(Number(value)); break
        case 'remove':   if (typeof value === 'number' && value < player.queue.size) player.queue.splice(value, 1); break
        case 'autoplay': (player as any).autoplay = !((player as any).autoplay ?? false); break
        default: return res.status(400).json({ error: `Unknown action: ${action}` })
      }
      await client.musicService.publishPlayerState(req.params.guildId, player)
      res.json({ success: true })
    } catch (err) { logger.error({ err, action }, 'Control error'); res.status(500).json({ error: 'Control failed' }) }
  })

  // ── Guild settings ────────────────────────────────────────────────────────
  app.get('/guild/:guildId/settings', async (req, res) => {
    const s = await client.musicService.getGuildSettings(req.params.guildId)
    res.json(s ?? {})
  })

  app.patch('/guild/:guildId/settings', async (req, res) => {
    try {
      const s = await prisma.guildSettings.upsert({ where: { guildId: req.params.guildId }, create: { guildId: req.params.guildId, ...req.body }, update: req.body })
      await client.musicService.invalidateSettingsCache(req.params.guildId)
      res.json(s)
    } catch { res.status(500).json({ error: 'Failed to update settings' }) }
  })

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get('/stats', (_, res) => {
    const nodes = [...client.kazagumo.shoukaku.nodes.values()].map(n => ({
      id: n.name, connected: n.state === 1,
      players: n.stats?.players ?? 0, playingPlayers: n.stats?.playingPlayers ?? 0,
      uptime: n.stats?.uptime ?? 0, memUsed: n.stats?.memory?.used ?? 0, cpuLoad: n.stats?.cpu?.lavalinkLoad ?? 0,
    }))
    res.json({ guilds: client.guilds.cache.size, users: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0), activePlayers: client.kazagumo.players.size, uptime: Date.now() - client.startTime, memoryUsage: process.memoryUsage().heapUsed, ping: client.ws.ping, lavalinkNodes: nodes, version: process.env.npm_package_version ?? '1.0.0' })
  })

  const PORT = parseInt(process.env.BOT_API_PORT ?? '4000')
  app.listen(PORT, () => logger.info(`Bot API listening on :${PORT}`))
}
