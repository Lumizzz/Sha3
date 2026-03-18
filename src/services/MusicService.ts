import type { HarmoniaClient } from '../client'
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo'
import { logger } from '../utils/logger'
import { prisma } from '../lib/db'

export class MusicService {
  // Track the now-playing message per guild so we can edit it instead of sending new ones
  nowPlayingMessages = new Map<string, { channelId: string; messageId: string }>()

  constructor(private client: HarmoniaClient) {}

  getPlayer(guildId: string): KazagumoPlayer | undefined {
    return this.client.kazagumo.players.get(guildId)
  }

  async createPlayer(opts: { guildId: string; voiceId: string; textId: string; deaf?: boolean }) {
    const vol = await this.getDefaultVolume(opts.guildId)
    return this.client.kazagumo.createPlayer({
      guildId: opts.guildId,
      voiceId: opts.voiceId,
      textId:  opts.textId,
      deaf:    opts.deaf ?? true,
      volume:  vol,
    })
  }

  // ── Universal search ──────────────────────────────────────────────────────
  async search(query: string, requester: { id: string; username: string; displayAvatarURL: () => string }, guildId?: string) {
    const spotifyTrack    = /^https?:\/\/(?:open\.)?spotify\.com\/track\/([A-Za-z0-9]+)/
    const spotifyPlaylist = /^https?:\/\/(?:open\.)?spotify\.com\/playlist\/([A-Za-z0-9]+)/
    const spotifyAlbum    = /^https?:\/\/(?:open\.)?spotify\.com\/album\/([A-Za-z0-9]+)/
    const appleMusic      = /^https?:\/\/music\.apple\.com\//

    // ── Spotify track ──────────────────────────────────────────────────────
    if (spotifyTrack.test(query)) {
      const [, id] = query.match(spotifyTrack)!
      const track = await this.client.spotifyProvider.getTrack(id)
      if (track) {
        const result = await this.client.kazagumo.search(
          `ytmsearch:${track.name} ${track.artists[0]?.name ?? ''}`, { requester }
        )
        if (result.tracks[0]) {
          result.tracks[0].title  = track.name
          result.tracks[0].author = track.artists.map((a: any) => a.name).join(', ')
          ;(result.tracks[0] as any).artworkUrl  = track.album.images[0]?.url
          ;(result.tracks[0] as any).isrc        = track.external_ids?.isrc
          ;(result.tracks[0] as any).sourceType  = 'SPOTIFY'
          ;(result.tracks[0] as any).originalUri = query
        }
        return result
      }
    }

    // ── Spotify playlist ───────────────────────────────────────────────────
    if (spotifyPlaylist.test(query)) {
      const [, id] = query.match(spotifyPlaylist)!
      const pl = await this.client.spotifyProvider.getPlaylist(id)
      if (pl) {
        const tracks: KazagumoTrack[] = []
        for (const { track } of pl.tracks.items.slice(0, 100)) {
          if (!track) continue
          try {
            const r = await this.client.kazagumo.search(
              `ytmsearch:${track.name} ${track.artists[0]?.name ?? ''}`, { requester }
            )
            if (r.tracks[0]) {
              r.tracks[0].title  = track.name
              r.tracks[0].author = track.artists.map((a: any) => a.name).join(', ')
              ;(r.tracks[0] as any).artworkUrl = track.album.images[0]?.url
              ;(r.tracks[0] as any).sourceType = 'SPOTIFY'
              tracks.push(r.tracks[0])
            }
          } catch { /* skip unresolvable */ }
        }
        return { type: 'PLAYLIST', playlistName: pl.name, tracks } as any
      }
    }

    // ── Spotify album ──────────────────────────────────────────────────────
    if (spotifyAlbum.test(query)) {
      const [, id] = query.match(spotifyAlbum)!
      const album = await this.client.spotifyProvider.getAlbum(id)
      if (album) {
        const tracks: KazagumoTrack[] = []
        for (const item of album.tracks.items.slice(0, 100)) {
          try {
            const r = await this.client.kazagumo.search(
              `ytmsearch:${item.name} ${item.artists[0]?.name ?? ''}`, { requester }
            )
            if (r.tracks[0]) {
              r.tracks[0].title  = item.name
              r.tracks[0].author = item.artists.map((a: any) => a.name).join(', ')
              ;(r.tracks[0] as any).artworkUrl = album.images[0]?.url
              ;(r.tracks[0] as any).sourceType = 'SPOTIFY'
              tracks.push(r.tracks[0])
            }
          } catch { /* skip */ }
        }
        return { type: 'PLAYLIST', playlistName: `${album.name} — ${album.artists[0]?.name}`, tracks } as any
      }
    }

    // ── Apple Music ────────────────────────────────────────────────────────
    if (appleMusic.test(query)) {
      const result = await this.client.appleMusicProvider.resolveToYouTube(query, this)
      if (result) return result
    }

    // ── YouTube / generic search ───────────────────────────────────────────
    const settings = guildId ? await this.getGuildSettings(guildId) : null
    if (!query.startsWith('http')) {
      query = `${settings?.searchProvider === 'YOUTUBE' ? 'ytsearch' : 'ytmsearch'}:${query}`
    }
    return this.client.kazagumo.search(query, { requester })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async ensureUserAndGuild(guildId: string, userId: string, username = 'Unknown', guildName = 'Unknown Server') {
    try {
      const guild = this.client.guilds.cache.get(guildId)
      const member = guild?.members.cache.get(userId)
      await prisma.guild.upsert({
        where: { id: guildId },
        create: { id: guildId, name: guild?.name ?? guildName, ownerId: guild?.ownerId ?? '0', memberCount: guild?.memberCount ?? 0 },
        update: { name: guild?.name ?? guildName },
      })
      await prisma.guildSettings.upsert({
        where: { guildId },
        create: { guildId },
        update: {},
      })
      await prisma.user.upsert({
        where: { id: userId },
        create: { id: userId, username: member?.user.username ?? username },
        update: { username: member?.user.username ?? username },
      })
    } catch (err) {
      logger.warn({ err }, 'Failed to ensure user/guild records')
    }
  }

  async addToHistory(guildId: string, userId: string, track: KazagumoTrack) {
    try {
      await this.ensureUserAndGuild(guildId, userId)
      await prisma.musicHistory.create({
        data: {
          guildId, userId,
          title: track.title, author: track.author ?? 'Unknown',
          duration: track.length ?? 0,
          thumbnail: track.thumbnail ?? undefined,
          uri: track.uri!,
          sourceType: ((track as any).sourceType as any) ?? 'YOUTUBE',
          isrc: (track as any).isrc ?? undefined,
        },
      })
    } catch (err) {
      logger.warn({ err }, 'Failed to record music history')
    }
  }

  async getDefaultVolume(guildId: string): Promise<number> {
    const s = await this.getGuildSettings(guildId)
    return s?.defaultVolume ?? 80
  }

  async getGuildSettings(guildId: string) {
    try {
      const cached = await this.client.redis.get(`settings:${guildId}`)
      if (cached) return JSON.parse(cached)
      const settings = await prisma.guildSettings.findUnique({ where: { guildId } })
      if (settings) await this.client.redis.setex(`settings:${guildId}`, 300, JSON.stringify(settings))
      return settings
    } catch {
      return null // Return null gracefully if DB is unavailable
    }
  }

  async invalidateSettingsCache(guildId: string) {
    await this.client.redis.del(`settings:${guildId}`)
  }

  async isDJ(guildId: string, userId: string, roleIds: string[]): Promise<boolean> {
    const ownerIds = (process.env.OWNER_IDS ?? '').split(',').map(s => s.trim())
    if (ownerIds.includes(userId)) return true
    const settings = await this.getGuildSettings(guildId)
    if (!settings?.djOnlyMode) return true
    const guild = this.client.guilds.cache.get(guildId)
    const member = guild?.members.cache.get(userId)
    if (!member) return false
    if (member.id === guild?.ownerId) return true
    if (member.permissions.has('Administrator')) return true
    return (settings.djRoleIds as string[]).some(id => member.roles.cache.has(id))
  }

  async publishPlayerState(guildId: string, player: KazagumoPlayer | null) {
    try {
      if (!player) {
        await this.client.redis.del(`player:${guildId}`)
        await this.client.redis.publish('player:update', JSON.stringify({ guildId, state: null }))
        return
      }
      const state = {
        guildId,
        isPlaying: player.playing,
        isPaused:  player.paused,
        volume:    player.volume,
        loop:      player.loop,
        autoplay:  (player as any).autoplay ?? false,
        is247:     (player as any).stay247 ?? false,
        position:  player.position,
        currentTrack: player.queue.current ? {
          title:         player.queue.current.title,
          author:        player.queue.current.author,
          duration:      player.queue.current.length,
          thumbnail:     player.queue.current.thumbnail,
          uri:           player.queue.current.uri,
          sourceType:    (player.queue.current as any).sourceType ?? 'YOUTUBE',
          artworkUrl:    (player.queue.current as any).artworkUrl,
          requesterName: (player.queue.current.requester as any)?.username ?? 'Unknown',
        } : null,
        queue: player.queue.map((t, i) => ({
          position:      i,
          title:         t.title,
          author:        t.author,
          duration:      t.length,
          thumbnail:     t.thumbnail,
          uri:           t.uri,
          sourceType:    (t as any).sourceType ?? 'YOUTUBE',
          requesterName: (t.requester as any)?.username ?? 'Unknown',
        })),
        queueLength: player.queue.size,
        timestamp:   Date.now(),
      }
      await this.client.redis.setex(`player:${guildId}`, 60, JSON.stringify(state))
      await this.client.redis.publish('player:update', JSON.stringify({ guildId, state }))
    } catch (err) {
      logger.warn({ err }, 'Failed to publish player state')
    }
  }
}
