import axios from 'axios'
import jwt from 'jsonwebtoken'
import { logger } from '../../utils/logger'
import type { MusicService } from '../../services/MusicService'

export class AppleMusicProvider {
  private devToken: string | null = null
  private tokenExpiry = 0
  private readonly base = 'https://api.music.apple.com/v1'

  constructor(private cfg: { keyId?: string; teamId?: string; privateKey?: string }) {}

  private genToken(): string | null {
    if (!this.cfg.keyId || !this.cfg.teamId || !this.cfg.privateKey) return null
    if (this.devToken && Date.now() < this.tokenExpiry - 60000) return this.devToken
    const now = Math.floor(Date.now() / 1000)
    this.devToken = jwt.sign({ iss: this.cfg.teamId, iat: now, exp: now + 15777000 }, this.cfg.privateKey, {
      algorithm: 'ES256', header: { alg: 'ES256', kid: this.cfg.keyId } as any,
    })
    this.tokenExpiry = (now + 15777000 - 60) * 1000
    return this.devToken
  }

  private async req<T>(endpoint: string, storefront = 'us'): Promise<T | null> {
    try {
      const token = this.genToken()
      if (!token) return null
      const r = await axios.get<T>(`${this.base}/catalog/${storefront}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return r.data
    } catch (err: any) {
      logger.warn({ endpoint, status: err.response?.status }, 'Apple Music API request failed')
      return null
    }
  }

  async resolveToYouTube(url: string, musicService: MusicService) {
    try {
      const songMatch     = url.match(/music\.apple\.com\/([a-z]{2})\/album\/[^/]+\/\d+\?i=(\d+)/)
      const playlistMatch = url.match(/music\.apple\.com\/([a-z]{2})\/playlist\/[^/]+\/(pl\.[a-z0-9]+)/i)

      if (songMatch) {
        const [, sf, trackId] = songMatch
        const data = await this.req<any>(`/songs/${trackId}`, sf)
        if (data?.data[0]) {
          const attr = data.data[0].attributes
          const client = (musicService as any).client
          const r = await client.kazagumo.search(`ytmsearch:${attr.name} ${attr.artistName}`, { requester: { id: 'system', username: 'Apple Music' } })
          if (r.tracks[0]) {
            r.tracks[0].title  = attr.name
            r.tracks[0].author = attr.artistName
            ;(r.tracks[0] as any).artworkUrl = attr.artwork?.url?.replace('{w}', '300').replace('{h}', '300')
            ;(r.tracks[0] as any).sourceType = 'APPLE_MUSIC'
          }
          return r
        }
      }

      if (playlistMatch) {
        const [, sf, plId] = playlistMatch
        const data = await this.req<any>(`/playlists/${plId}`, sf)
        if (data?.data[0]) {
          const pl = data.data[0]
          const client = (musicService as any).client
          const tracks = []
          for (const track of (pl.relationships?.tracks?.data ?? []).slice(0, 100)) {
            const attr = track.attributes
            if (!attr) continue
            try {
              const r = await client.kazagumo.search(`ytmsearch:${attr.name} ${attr.artistName}`, { requester: { id: 'system', username: 'Apple Music' } })
              if (r.tracks[0]) {
                r.tracks[0].title  = attr.name
                r.tracks[0].author = attr.artistName
                ;(r.tracks[0] as any).artworkUrl = attr.artwork?.url?.replace('{w}', '300').replace('{h}', '300')
                ;(r.tracks[0] as any).sourceType = 'APPLE_MUSIC'
                tracks.push(r.tracks[0])
              }
            } catch { /* skip */ }
          }
          return { type: 'PLAYLIST', playlistName: pl.attributes?.name ?? 'Apple Music Playlist', tracks } as any
        }
      }
      return null
    } catch (err) {
      logger.error({ err }, 'Apple Music resolution failed')
      return null
    }
  }
}
