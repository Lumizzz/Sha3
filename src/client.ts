import {
  Client, GatewayIntentBits, Partials, Collection, REST, Routes, Options,
} from 'discord.js'
import { join } from 'path'
import { Kazagumo, Plugins } from 'kazagumo'
import { Connectors, type NodeOption } from 'shoukaku'
import { Redis } from 'ioredis'
import { readdirSync } from 'fs'
import { logger } from './utils/logger'
import type { Command, Event } from './types/index'
import { MusicService } from './services/MusicService'
import { SpotifyProvider } from './music/providers/SpotifyProvider'
import { AppleMusicProvider } from './music/providers/AppleMusicProvider'


export class HarmoniaClient extends Client {
  commands   = new Collection<string, Command>()
  cooldowns  = new Collection<string, Collection<string, number>>()
  kazagumo!: Kazagumo
  redis!: Redis
  musicService!: MusicService
  spotifyProvider!: SpotifyProvider
  appleMusicProvider!: AppleMusicProvider
  startTime = Date.now()

  constructor() {
    // Validate required env vars at startup
    const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID']
    const missing = required.filter(k => !process.env[k])
    if (missing.length) {
      console.error(`❌ Missing required env vars: ${missing.join(', ')}`)
      process.exit(1)
    }
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
      allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
      // Memory optimizations for low-RAM hosting (Wispbyte free = 512MB)
      sweepers: {
        messages: { interval: 300, lifetime: 600 },   // sweep messages every 5min, keep 10min
        users:    { interval: 600, filter: () => user => !user.bot },
        guildMembers: { interval: 600, filter: () => member => !member.user?.bot },
      },
      makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 50,
        GuildMemberManager: 200,
        UserManager: 200,
        ReactionManager: 0,
        GuildEmojiManager: 0,
        BaseGuildEmojiManager: 0,
        StageInstanceManager: 0,
        GuildStickerManager: 0,
      }),
    })
    this.initRedis()
    this.initProviders()
    this.initKazagumo()
    this.musicService = new MusicService(this)
  }

  private initRedis() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    })
    this.redis.on('error', err => logger.error({ err }, 'Redis error'))
    this.redis.on('connect', () => logger.info('Redis connected'))
    this.redis.connect().catch(err => logger.warn({ err }, 'Redis initial connect failed — retrying'))
  }

  private initProviders() {
    this.spotifyProvider = new SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
    })
    this.appleMusicProvider = new AppleMusicProvider({
      keyId: process.env.APPLE_MUSIC_KEY_ID,
      teamId: process.env.APPLE_MUSIC_TEAM_ID,
      privateKey: process.env.APPLE_MUSIC_PRIVATE_KEY,
    })
  }

  private initKazagumo() {
    const nodes: NodeOption[] = [{
      name: 'main',
      url: `${process.env.LAVALINK_HOST ?? 'localhost'}:${process.env.LAVALINK_PORT ?? 2333}`,
      auth: process.env.LAVALINK_PASSWORD ?? 'youshallnotpass',
      secure: process.env.LAVALINK_SECURE === 'true',
    }]

    this.kazagumo = new Kazagumo(
      {
        defaultSearchEngine: 'youtube_music',
        plugins: [new Plugins.PlayerMoved(this)],
        send: (guildId, payload) => {
          const guild = this.guilds.cache.get(guildId)
          guild?.shard.send(payload)
        },
      },
      new Connectors.DiscordJS(this),
      nodes,
      { moveOnDisconnect: false, resume: false, reconnectTries: 3, restTimeout: 60000 }
    )

    this.kazagumo.shoukaku.on('ready',        name => logger.info(`Lavalink node "${name}" connected`))
    this.kazagumo.shoukaku.on('error',        (name, err) => logger.error({ err }, `Lavalink node "${name}" error`))
    this.kazagumo.shoukaku.on('disconnect',   name => logger.warn(`Lavalink node "${name}" disconnected`))
    this.kazagumo.shoukaku.on('reconnecting', name => logger.info(`Lavalink node "${name}" reconnecting`))
  }

  // ── Loaders ────────────────────────────────────────────────────────────────

  async loadCommands() {
    const dir = join(__dirname, 'commands')
    for (const folder of readdirSync(dir)) {
      const folderPath = join(dir, folder)
      const stat = require('fs').statSync(folderPath)
      const files = stat.isDirectory()
        ? readdirSync(folderPath).filter(f => f.endsWith('.js') || f.endsWith('.ts')).map(f => join(folderPath, f))
        : (folderPath.endsWith('.js') || folderPath.endsWith('.ts')) ? [folderPath] : []
      for (const filePath of files) {
        try {
          const mod = await import(filePath)
          const cmds = Object.values(mod).filter((v: any) => v?.data && v?.execute)
          for (const cmd of cmds as Command[]) {
            this.commands.set(cmd.data.name, cmd)
            logger.debug(`Loaded command: ${cmd.data.name}`)
          }
        } catch (err) {
          logger.error({ err, file: filePath }, 'Failed to load command')
        }
      }
    }
    logger.info(`✅ Loaded ${this.commands.size} commands`)
  }

  async loadEvents() {
    const dir = join(__dirname, 'events')
    for (const folder of readdirSync(dir)) {
      const folderPath = join(dir, folder)
      const stat = require('fs').statSync(folderPath)
      const files = stat.isDirectory()
        ? readdirSync(folderPath).filter(f => f.endsWith('.js') || f.endsWith('.ts')).map(f => join(folderPath, f))
        : (folderPath.endsWith('.js') || folderPath.endsWith('.ts')) ? [folderPath] : []
      for (const filePath of files) {
        try {
          const mod = await import(filePath)
          const events = Object.values(mod).filter((v: any) => v?.name && v?.execute) as Event[]
          for (const event of events) {
            const emitter: any = event.emitter === 'kazagumo' ? this.kazagumo : this
            const fn = (...args: any[]) => event.execute(this, ...args)
            event.once ? emitter.once(event.name, fn) : emitter.on(event.name, fn)
          }
        } catch (err) {
          logger.error({ err, file: filePath }, 'Failed to load event')
        }
      }
    }
    logger.info('✅ Events registered')
  }

  async registerSlashCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!)
    const commands = this.commands.map(cmd => cmd.data.toJSON())
    const guildId = process.env.DISCORD_GUILD_ID
    const clientId = process.env.DISCORD_CLIENT_ID!
    try {
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
        logger.info(`Slash commands registered to guild ${guildId} (instant)`)
      } else {
        await rest.put(Routes.applicationCommands(clientId), { body: commands })
        logger.info('Slash commands registered globally (up to 1hr)')
      }
    } catch (err) {
      logger.error({ err }, 'Failed to register slash commands')
    }
  }

  override async login(token?: string) {
    await this.loadCommands()
    await this.loadEvents()
    return super.login(token)
  }
}
