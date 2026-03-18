import { Events, ActivityType, Collection, type Guild, type VoiceState } from 'discord.js'
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo'
import type { Event } from '../types/index'
import type { HarmoniaClient } from '../client'
import { buildNowPlayingEmbed, buildPlayerControls, buildSecondaryControls, buildExtraControls, buildQualitySelect, buildErrorEmbed } from '../utils/embeds'
import { logger } from '../utils/logger'
import { prisma } from '../lib/db'

// ── ready ─────────────────────────────────────────────────────────────────────
export const ready: Event = {
  name: Events.ClientReady, once: true,
  async execute(client: HarmoniaClient) {
    logger.info(`✅ Logged in as ${client.user?.tag}`)
    await (client as HarmoniaClient).registerSlashCommands().catch(err => logger.warn({ err }, 'Slash command registration failed — bot will still work'))
    const setPresence = () => client.user?.setPresence({ activities: [{ name: `🎵 music in ${client.guilds.cache.size} servers | /play`, type: ActivityType.Listening }], status: 'online' })
    setPresence(); setInterval(setPresence, 5 * 60 * 1000)

    // Realtime progress bar updater — edits now-playing embeds every 15s
    setInterval(async () => {
      for (const [guildId, ref] of client.musicService.nowPlayingMessages.entries()) {
        try {
          const player = client.musicService.getPlayer(guildId)
          if (!player?.playing || !player.queue.current) continue
          const settings = await client.musicService.getGuildSettings(guildId)
          const ch = client.channels.cache.get(ref.channelId) as any
          if (!ch) continue
          const msg = await ch.messages.fetch(ref.messageId).catch(() => null)
          if (!msg) { client.musicService.nowPlayingMessages.delete(guildId); continue }
          const embed = buildNowPlayingEmbed(player, player.queue.current, settings?.embedColor)
          await msg.edit({ embeds: [embed] }).catch(() => null)
        } catch { /* skip */ }
      }
    }, 15_000)
  },
}

// ── interactionCreate ────────────────────────────────────────────────────────
export const interactionCreate: Event = {
  name: Events.InteractionCreate,
  async execute(client: HarmoniaClient, interaction: any) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName)
      if (!command) return

      if (command.voiceOnly && !interaction.member?.voice?.channel) {
        return interaction.reply({ embeds: [buildErrorEmbed('You must be in a voice channel.')], ephemeral: true })
      }

      if (command.cooldown) {
        if (!client.cooldowns.has(command.data.name)) client.cooldowns.set(command.data.name, new Collection<string, number>())
        const timestamps = client.cooldowns.get(command.data.name)!
        const now = Date.now(), cooldownMs = command.cooldown * 1000
        if (timestamps.has(interaction.user.id)) {
          const expiry = timestamps.get(interaction.user.id)! + cooldownMs
          if (now < expiry) return interaction.reply({ embeds: [buildErrorEmbed(`Wait **${((expiry-now)/1000).toFixed(1)}s** before using \`/${command.data.name}\` again.`)], ephemeral: true })
        }
        timestamps.set(interaction.user.id, now); setTimeout(() => timestamps.delete(interaction.user.id), cooldownMs)
      }

      try {
        await command.execute(client, interaction)
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'Command error')
        const msg = { embeds: [buildErrorEmbed('An unexpected error occurred.')], ephemeral: true }
        if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => null)
        else await interaction.reply(msg).catch(() => null)
      }
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName)
      if (command?.autocomplete) await command.autocomplete(client, interaction).catch(() => null)
    }

    if (interaction.isStringSelectMenu()) {
      const [prefix, action] = interaction.customId.split(':')
      if (prefix !== 'player') return
      await interaction.deferUpdate()
      const p = client.musicService.getPlayer(interaction.guildId!)
      if (!p) return
      if (action === 'quality') {
        const preset = interaction.values[0] // e.g. "low", "medium", "high", "veryhigh", "best"
        const presets: Record<string, { label: string; emoji: string; filters: object }> = {
          low:      { label: '64kbps',  emoji: '🔇', filters: { equalizer: [{band:0,gain:-0.2},{band:1,gain:-0.2},{band:2,gain:-0.1},{band:5,gain:-0.1},{band:6,gain:-0.1},{band:7,gain:-0.1},{band:8,gain:-0.1}] } },
          medium:   { label: '128kbps', emoji: '📻', filters: {} },
          high:     { label: '192kbps', emoji: '🎵', filters: { equalizer: [{band:0,gain:0.1},{band:1,gain:0.1},{band:2,gain:0.05},{band:5,gain:0.05},{band:6,gain:0.1},{band:7,gain:0.1},{band:8,gain:0.1}] } },
          veryhigh: { label: '256kbps', emoji: '🎶', filters: { equalizer: [{band:0,gain:0.15},{band:1,gain:0.15},{band:2,gain:0.1},{band:3,gain:0.05},{band:6,gain:0.1},{band:7,gain:0.15},{band:8,gain:0.2},{band:9,gain:0.2},{band:10,gain:0.15},{band:11,gain:0.1},{band:12,gain:0.1}] } },
          best:     { label: '320kbps', emoji: '💎', filters: { equalizer: [{band:0,gain:0.2},{band:1,gain:0.2},{band:2,gain:0.15},{band:3,gain:0.1},{band:4,gain:0.05},{band:7,gain:0.1},{band:8,gain:0.15},{band:9,gain:0.2},{band:10,gain:0.2},{band:11,gain:0.2},{band:12,gain:0.2}] } },
        }
        const cfg = presets[preset]
        if (cfg) {
          try {
            await p.shoukaku.setFilters(cfg.filters)
            ;(p as any).currentQuality = preset
            await interaction.followUp({ content: `${cfg.emoji} Quality set to **${cfg.label}**`, ephemeral: true }).catch(() => null)
          } catch { /* ignore */ }
        }
      }
      return
    }

    if (interaction.isButton()) {
      const [prefix, action] = interaction.customId.split(':')
      if (prefix !== 'player') return
      await interaction.deferUpdate()
      const p = client.musicService.getPlayer(interaction.guildId!)
      if (!p) return
      try {
        switch (action) {
          case 'pause':       if (!p.paused) await p.pause(true); break
          case 'resume':      if (p.paused)  await p.pause(false); break
          case 'skip':        await p.skip(); break
          case 'stop':        p.queue.clear(); await p.skip(); break
          case 'shuffle':     p.queue.shuffle(); break
          case 'loop':        { const m = ['none','track','queue'] as const; p.setLoop(m[(m.indexOf(p.loop as any)+1)%3]); break }
          case 'autoplay':    (p as any).autoplay = !((p as any).autoplay ?? false); break
          case 'nowplaying': {
            const { buildNowPlayingEmbed: npEmbed, buildPlayerControls: npCtrl, buildSecondaryControls: npSec, buildExtraControls: npExtra, buildQualitySelect: npQual } = await import('../utils/embeds')
            if (p.queue.current) {
              const s = await client.musicService.getGuildSettings(interaction.guildId!)
              await interaction.followUp({ embeds: [npEmbed(p, p.queue.current, s?.embedColor)], components: [npCtrl(p.paused), npSec(p.loop ?? 'none', (p as any).autoplay ?? false), npExtra(p.loop ?? 'none', (p as any).autoplay ?? false), npQual()], ephemeral: false }).catch(() => null)
            }
            break
          }
          case 'volumeup':    await p.setVolume(Math.min((p.volume ?? 80) + 10, 150)); break
          case 'volumedown':  await p.setVolume(Math.max((p.volume ?? 80) - 10, 1)); break
          case 'rewind':      await p.shoukaku.seekTo(Math.max((p.position ?? 0) - 10000, 0)); break
          case 'fastforward': await p.shoukaku.seekTo(Math.min((p.position ?? 0) + 10000, p.queue.current?.length ?? 0)); break
          case 'favorite': {
            try {
              const t = p.queue.current
              if (t && interaction.user) {
                const { prisma } = await import('../lib/db')
                await prisma.user.upsert({ where: { id: interaction.user.id }, create: { id: interaction.user.id, username: interaction.user.username }, update: {} })
                await prisma.favorite.upsert({ where: { userId_uri: { userId: interaction.user.id, uri: t.uri! } }, create: { userId: interaction.user.id, title: t.title, author: t.author ?? 'Unknown', duration: t.length ?? 0, thumbnail: t.thumbnail ?? undefined, uri: t.uri!, sourceType: ((t as any).sourceType ?? 'YOUTUBE') as any }, update: {} })
                await interaction.followUp({ content: `❤️ Added **${t.title}** to favorites`, ephemeral: true }).catch(() => null)
              }
            } catch { /* ignore */ }
            break
          }
        }
        await client.musicService.publishPlayerState(interaction.guildId!, p)
      } catch (err) { logger.warn({ err, action }, 'Button error') }
    }
  },
}

// ── guildCreate ───────────────────────────────────────────────────────────────
export const guildCreate: Event = {
  name: Events.GuildCreate,
  async execute(_client: HarmoniaClient, guild: Guild) {
    logger.info({ guildId: guild.id, name: guild.name }, 'Joined guild')
    try {
      await prisma.guild.upsert({ where: { id: guild.id }, create: { id: guild.id, name: guild.name, icon: guild.icon ?? undefined, ownerId: guild.ownerId, memberCount: guild.memberCount }, update: { name: guild.name, icon: guild.icon ?? undefined, ownerId: guild.ownerId, memberCount: guild.memberCount } })
      await prisma.guildSettings.upsert({ where: { guildId: guild.id }, create: { guildId: guild.id }, update: {} })
    } catch (err) { logger.error({ err }, 'Failed to register guild') }
  },
}

export const guildDelete: Event = {
  name: Events.GuildDelete,
  async execute(_client: HarmoniaClient, guild: Guild) {
    logger.info({ guildId: guild.id }, 'Left guild')
  },
}

export const guildUpdate: Event = {
  name: Events.GuildUpdate,
  async execute(_client: HarmoniaClient, _old: Guild, g: Guild) {
    try { await prisma.guild.update({ where: { id: g.id }, data: { name: g.name, icon: g.icon ?? undefined, memberCount: g.memberCount } }) } catch {}
  },
}

// ── voiceStateUpdate ──────────────────────────────────────────────────────────
const emptyTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const voiceStateUpdate: Event = {
  name: Events.VoiceStateUpdate,
  async execute(client: HarmoniaClient, oldState: VoiceState, newState: VoiceState) {
    const guildId = oldState.guild.id
    const player = client.musicService.getPlayer(guildId)
    if (!player) return

    // Bot force-disconnected
    if (oldState.id === client.user?.id && oldState.channelId && !newState.channelId) {
      if ((player as any).stay247 && oldState.channelId) {
        setTimeout(async () => {
          try { await player.setVoiceChannel(oldState.channelId!); logger.info({ guildId }, '24/7: rejoined voice') }
          catch (err) { logger.warn({ err }, 'Failed to rejoin voice') }
        }, 3000)
      } else { try { await player.destroy() } catch {} ; await client.musicService.publishPlayerState(guildId, null) }
      return
    }

    // Auto-disconnect when alone
    const botChannel = newState.guild.members.me?.voice.channel
    if (!botChannel) return
    const alone = botChannel.members.filter(m => !m.user.bot).size === 0
    const is247 = (player as any).stay247 ?? false

    if (alone && !is247) {
      if (!emptyTimers.has(guildId)) {
        const t = setTimeout(async () => {
          emptyTimers.delete(guildId)
          const p = client.musicService.getPlayer(guildId)
          if (p && !(p as any).stay247) {
            try { await p.destroy() } catch {} ; await client.musicService.publishPlayerState(guildId, null)
            logger.info({ guildId }, 'Auto-disconnected: channel empty')
          }
        }, 30_000)
        emptyTimers.set(guildId, t)
      }
    } else {
      const t = emptyTimers.get(guildId)
      if (t) { clearTimeout(t); emptyTimers.delete(guildId) }
    }
  },
}

// ── Kazagumo player events ────────────────────────────────────────────────────
export const playerStart: Event = {
  name: 'playerStart', emitter: 'kazagumo',
  async execute(client: HarmoniaClient, player: KazagumoPlayer, track: KazagumoTrack) {
    logger.info({ guild: player.guildId, track: track.title }, 'Track started')
    const settings = await client.musicService.getGuildSettings(player.guildId)
    const components = [
      buildPlayerControls(false),
      buildSecondaryControls(player.loop ?? 'none', (player as any).autoplay ?? false),
      buildExtraControls(player.loop ?? 'none', (player as any).autoplay ?? false),
      buildQualitySelect(),
    ]
    const embed = buildNowPlayingEmbed(player, track, settings?.embedColor)

    // Try to edit existing now-playing message (realtime update)
    const existing = client.musicService.nowPlayingMessages.get(player.guildId)
    if (existing) {
      try {
        const ch = client.channels.cache.get(existing.channelId) as any
        const msg = await ch?.messages?.fetch(existing.messageId)
        if (msg) {
          await msg.edit({ embeds: [embed], components })
          return
        }
      } catch { /* message was deleted, send new one */ }
    }

    // Send new now-playing message and store reference
    if (player.textId) {
      const channel = client.channels.cache.get(player.textId) as any
      if (channel?.send) {
        const msg = await channel.send({ embeds: [embed], components }).catch(() => null)
        if (msg) client.musicService.nowPlayingMessages.set(player.guildId, { channelId: player.textId, messageId: msg.id })
      }
    }
    const requesterId = (track.requester as any)?.id
    if (requesterId) await client.musicService.addToHistory(player.guildId, requesterId, track).catch(() => null)
    await client.musicService.publishPlayerState(player.guildId, player)
  },
}

export const playerEnd: Event = {
  name: 'playerEnd', emitter: 'kazagumo',
  async execute(client: HarmoniaClient, player: KazagumoPlayer) {
    await client.musicService.publishPlayerState(player.guildId, player)
  },
}

export const playerEmpty: Event = {
  name: 'playerEmpty', emitter: 'kazagumo',
  async execute(client: HarmoniaClient, player: KazagumoPlayer) {
    logger.info({ guild: player.guildId }, 'Queue empty')
    if ((player as any).autoplay && player.queue.current) {
      try {
        const r = await client.kazagumo.search(`ytmsearch:${player.queue.current.author} mix`, { requester: { id: 'autoplay', username: 'Autoplay' } })
        const related = r.tracks.find(t => t.uri !== player.queue.current?.uri)
        if (related) { player.queue.add(related); await player.play(); return }
      } catch (err) { logger.warn({ err }, 'Autoplay failed') }
    }
    if ((player as any).stay247) { await client.musicService.publishPlayerState(player.guildId, null); return }
    setTimeout(async () => {
      const p = client.musicService.getPlayer(player.guildId)
      if (p && !p.playing && !p.paused) { try { await p.destroy() } catch {} ; await client.musicService.publishPlayerState(player.guildId, null) }
    }, 30_000)
  },
}

export const playerDestroyed: Event = {
  name: 'playerDestroyed', emitter: 'kazagumo',
  async execute(client: HarmoniaClient, player: KazagumoPlayer) {
    logger.info({ guild: player.guildId }, 'Player destroyed')
    // Disable all buttons on the now-playing message
    const existing = client.musicService.nowPlayingMessages.get(player.guildId)
    if (existing) {
      try {
        const ch = client.channels.cache.get(existing.channelId) as any
        const msg = await ch?.messages?.fetch(existing.messageId)
        if (msg) {
          const disabledComponents = msg.components.map((row: any) => {
            const newRow = row.toJSON()
            newRow.components = newRow.components.map((c: any) => ({ ...c, disabled: true }))
            return newRow
          })
          await msg.edit({ components: disabledComponents }).catch(() => null)
        }
      } catch {}
      client.musicService.nowPlayingMessages.delete(player.guildId)
    }
    await client.musicService.publishPlayerState(player.guildId, null)
  },
}

export const playerException: Event = {
  name: 'playerException', emitter: 'kazagumo',
  async execute(client: HarmoniaClient, player: KazagumoPlayer, track: KazagumoTrack, error: Error) {
    logger.error({ guild: player.guildId, track: track?.title, error }, 'Player exception')
    if (player.queue.size > 0) try { await player.skip() } catch {}
  },
}
