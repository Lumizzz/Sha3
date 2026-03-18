import axios from 'axios'
import { logger } from '../../utils/logger'

export class SpotifyProvider {
  private token: { access_token: string; expires_at: number } | null = null
  private readonly base = 'https://api.spotify.com/v1'

  constructor(private cfg: { clientId: string; clientSecret: string }) {}

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expires_at - 10000) return this.token.access_token
    const creds = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')
    const r = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    this.token = { access_token: r.data.access_token, expires_at: Date.now() + r.data.expires_in * 1000 }
    return this.token.access_token
  }

  private async req<T>(endpoint: string): Promise<T | null> {
    try {
      const token = await this.getToken()
      const r = await axios.get<T>(`${this.base}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } })
      return r.data
    } catch (err: any) {
      logger.warn({ endpoint, status: err.response?.status }, 'Spotify API request failed')
      return null
    }
  }

  getTrack(id: string)    { return this.req<SpotifyTrack>(`/tracks/${id}`) }
  getPlaylist(id: string) { return this.req<SpotifyPlaylist>(`/playlists/${id}?limit=100`) }
  getAlbum(id: string)    { return this.req<SpotifyAlbum>(`/albums/${id}`) }
  search(q: string, type = 'track', limit = 5) {
    return this.req<any>(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`)
  }
}

export interface SpotifyTrack {
  id: string; name: string; duration_ms: number; preview_url: string | null
  external_urls: { spotify: string }; external_ids: { isrc?: string }
  artists: Array<{ id: string; name: string }>
  album: { id: string; name: string; images: Array<{ url: string }> }
}
export interface SpotifyPlaylist {
  id: string; name: string; description: string; images: Array<{ url: string }>
  owner: { display_name: string }; external_urls: { spotify: string }
  tracks: { total: number; items: Array<{ track: SpotifyTrack }> }
}
export interface SpotifyAlbum {
  id: string; name: string; images: Array<{ url: string }>
  artists: Array<{ id: string; name: string }>
  tracks: { items: Array<{ id: string; name: string; duration_ms: number; artists: Array<{ id: string; name: string }> }> }
}
