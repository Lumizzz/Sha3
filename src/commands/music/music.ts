import { SlashCommandBuilder, EmbedBuilder } from 'discord.js'
import type { Command } from '../../types/index'
import { buildErrorEmbed, buildSuccessEmbed, buildNowPlayingEmbed, buildPlayerControls, buildSecondaryControls, buildExtraControls, buildQualitySelect } from '../../utils/embeds'
import { applyFilter, type FilterName } from '../../music/filters/filters'
import { prisma } from '../../lib/db'
import { logger } from '../../utils/logger'
import axios from 'axios'

function fmtMs(ms: number): string {
  const s = Math.floor(ms/1000), h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

// ── /play ─────────────────────────────────────────────────────────────────────
export const play: Command = {
  data: new SlashCommandBuilder().setName('play').setDescription('Play a song or playlist from YouTube, Spotify, Apple Music, or SoundCloud')
    .addStringOption(o => o.setName('query').setDescription('Song name, URL, or playlist link').setRequired(true).setAutocomplete(true))
    .addBooleanOption(o => o.setName('next').setDescription('Add to front of queue').setRequired(false)),
  voiceOnly: true,
  async execute(client, interaction) {
    await interaction.deferReply()
    const member = interaction.guild?.members.cache.get(interaction.user.id)
    const voiceChannel = member?.voice.channel
    if (!voiceChannel) return interaction.editReply({ embeds: [buildErrorEmbed('You must be in a voice channel.')] })

    const botVC = interaction.guild?.members.me?.voice.channel
    if (botVC && botVC.id !== voiceChannel.id) return interaction.editReply({ embeds: [buildErrorEmbed(`I'm already playing in <#${botVC.id}>`)] })

    const isDJ = await client.musicService.isDJ(interaction.guildId!, interaction.user.id, member?.roles.cache.map(r => r.id) ?? [])
    if (!isDJ) return interaction.editReply({ embeds: [buildErrorEmbed('You need the DJ role to use music commands.')] })

    // Check Lavalink is connected before even trying
    const nodes = [...client.kazagumo.shoukaku.nodes.values()]
    const connectedNode = nodes.find(n => n.state === 1)
    if (!connectedNode) {
      return interaction.editReply({ embeds: [buildErrorEmbed('Music server (Lavalink) is not connected. Check `LAVALINK_HOST`, `LAVALINK_PORT` and `LAVALINK_PASSWORD` env vars.')] })
    }

    const query = interaction.options.getString('query', true)
    const playNext = interaction.options.getBoolean('next') ?? false

    try {
      // Wrap search in a timeout so it never hangs forever
      const searchPromise = client.musicService.search(
        query,
        { id: interaction.user.id, username: interaction.user.displayName, displayAvatarURL: () => interaction.user.displayAvatarURL() },
        interaction.guildId!
      )
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Search timed out after 15s — Lavalink may be unreachable')), 15000)
      )
      const result = await Promise.race([searchPromise, timeoutPromise])

      if (!result?.tracks.length) return interaction.editReply({ embeds: [buildErrorEmbed(`No results found for **${query}**`)] })

      let player = client.musicService.getPlayer(interaction.guildId!)
      if (!player) player = await client.musicService.createPlayer({ guildId: interaction.guildId!, voiceId: voiceChannel.id, textId: interaction.channelId })

      const settings = await client.musicService.getGuildSettings(interaction.guildId!)
      const maxQueue = settings?.maxQueueSize ?? 500

      if (result.type === 'PLAYLIST') {
        const toAdd = result.tracks.slice(0, maxQueue - player.queue.size)
        if (playNext) { for (let i = toAdd.length-1; i >= 0; i--) player.queue.unshift(toAdd[i]) }
        else player.queue.add(toAdd)
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#5865F2').setDescription(`✅ Added **${toAdd.length}** tracks from **${result.playlistName ?? 'playlist'}** to queue`).setFooter({ text: `Total in queue: ${player.queue.size}` })] })
      } else {
        if (player.queue.size >= maxQueue) return interaction.editReply({ embeds: [buildErrorEmbed(`Queue is full (${maxQueue} tracks max).`)] })
        const track = result.tracks[0]
        if (playNext) player.queue.unshift(track)
        else player.queue.add(track)
        if (player.playing || player.paused) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#5865F2').setAuthor({ name: '➕ Added to Queue' }).setTitle(track.title.slice(0, 256)).setURL(track.uri ?? null).setThumbnail((track as any).artworkUrl ?? track.thumbnail ?? null).addFields({ name: '⏱️ Duration', value: fmtMs(track.length ?? 0), inline: true }, { name: '📍 Position', value: playNext ? '#1 (next)' : `#${player.queue.size}`, inline: true })] })
        } else {
          const s = await client.musicService.getGuildSettings(interaction.guildId!)
          const replyMsg = await interaction.editReply({
            embeds: [buildNowPlayingEmbed(player, track, s?.embedColor)],
            components: [buildPlayerControls(false), buildSecondaryControls(player.loop ?? 'none', (player as any).autoplay ?? false), buildExtraControls(player.loop ?? 'none', (player as any).autoplay ?? false), buildQualitySelect()],
          })
          // Store message reference for realtime editing
          if (replyMsg) client.musicService.nowPlayingMessages.set(interaction.guildId!, { channelId: interaction.channelId, messageId: replyMsg.id })
        }
      }
      if (!player.playing && !player.paused) await player.play()
      await client.musicService.publishPlayerState(interaction.guildId!, player)
      try { await client.musicService.ensureUserAndGuild(interaction.guildId!, interaction.user.id, interaction.user.username); await prisma.commandLog.create({ data: { guildId: interaction.guildId!, userId: interaction.user.id, command: 'play', args: { query }, success: true, latencyMs: Date.now() - interaction.createdTimestamp } }) } catch {}
    } catch (err: any) {
      logger.error({ err, query }, 'Play command error')
      const msg = err?.message ?? 'Unknown error'
      if (msg.includes('timed out') || msg.includes('Lavalink')) {
        await interaction.editReply({ embeds: [buildErrorEmbed(`❌ Music server timed out.\nCheck your **LAVALINK_HOST**, **LAVALINK_PORT** and **LAVALINK_PASSWORD** env vars.`)] })
      } else if (msg.includes('Spotify') || msg.includes('401') || msg.includes('credentials')) {
        await interaction.editReply({ embeds: [buildErrorEmbed(`❌ Spotify authentication failed.\nCheck your **SPOTIFY_CLIENT_ID** and **SPOTIFY_CLIENT_SECRET** env vars.`)] })
      } else {
        await interaction.editReply({ embeds: [buildErrorEmbed(`❌ ${msg.slice(0, 200)}`)] })
      }
    }
  },
  async autocomplete(client, interaction) {
    const q = interaction.options.getFocused()
    if (!q || q.length < 2) return interaction.respond([])
    try {
      const nodes = [...client.kazagumo.shoukaku.nodes.values()]
      if (!nodes.find(n => n.state === 1)) return interaction.respond([])
      const searchPromise = client.kazagumo.search(`ytmsearch:${q}`, { requester: interaction.user })
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
      const r = await Promise.race([searchPromise, timeoutPromise])
      await interaction.respond(r.tracks.slice(0,5).map(t => ({ name: `${t.title} — ${t.author}`.slice(0,100), value: t.uri ?? q })))
    } catch { await interaction.respond([]) }
  },
}

// ── /lyrics ───────────────────────────────────────────────────────────────────
export const lyrics: Command = {
  data: new SlashCommandBuilder().setName('lyrics').setDescription('Fetch lyrics for current or specified track')
    .addStringOption(o => o.setName('query').setDescription('Song name (defaults to current track)').setRequired(false)),
  async execute(client, interaction) {
    await interaction.deferReply()
    let query = interaction.options.getString('query')
    if (!query) {
      const p = client.musicService.getPlayer(interaction.guildId!)
      if (!p?.queue.current) return interaction.editReply({ embeds: [buildErrorEmbed('Nothing is playing. Provide a song name.')] })
      query = `${p.queue.current.title} ${p.queue.current.author}`
    }
    try {
      const r = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { timeout: 5000 })
      const result = r.data?.[0]
      if (!result || result.instrumental) return interaction.editReply({ embeds: [buildErrorEmbed(`No lyrics found for **${query}**`)] })
      const lyrics = result.plainLyrics ?? result.syncedLyrics?.replace(/\[\d+:\d+\.\d+\]/g, '').trim()
      if (!lyrics) return interaction.editReply({ embeds: [buildErrorEmbed('Lyrics unavailable.')] })
      const truncated = lyrics.length > 3800 ? lyrics.slice(0, 3800) + '\n\n*...truncated*' : lyrics
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle(`📝 ${result.trackName}`).setDescription(truncated).addFields({ name: 'Artist', value: result.artistName, inline: true }, { name: 'Album', value: result.albumName || 'Unknown', inline: true }).setFooter({ text: 'Lyrics by LRCLIB (lrclib.net)' })] })
    } catch { await interaction.editReply({ embeds: [buildErrorEmbed('Could not fetch lyrics. Try again later.')] }) }
  },
}

// ── /filter ───────────────────────────────────────────────────────────────────
export const filter: Command = {
  data: new SlashCommandBuilder().setName('filter').setDescription('Apply an audio filter')
    .addStringOption(o => o.setName('name').setDescription('Filter').setRequired(true)
      .addChoices({ name: '🎸 Bassboost', value: 'bassboost' }, { name: '🌙 Nightcore', value: 'nightcore' }, { name: '🌊 Vaporwave', value: 'vaporwave' }, { name: '🎤 Karaoke', value: 'karaoke' }, { name: '🎼 Treble', value: 'treble' }, { name: '🌀 8D Audio', value: '8d' }, { name: '⏱️ Timescale', value: 'timescale' }, { name: '❌ Reset', value: 'reset' })),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p?.queue.current) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const name = interaction.options.getString('name', true) as FilterName
    try {
      await applyFilter(p, name)
      const labels: Record<FilterName, string> = { bassboost: '🎸 Bassboost', nightcore: '🌙 Nightcore', vaporwave: '🌊 Vaporwave', karaoke: '🎤 Karaoke', treble: '🎼 Treble', '8d': '🌀 8D Audio', timescale: '⏱️ Timescale', reset: '❌ Reset' }
      await interaction.reply({ embeds: [buildSuccessEmbed(`Filter applied: **${labels[name]}**`)] })
    } catch { await interaction.reply({ embeds: [buildErrorEmbed('Failed to apply filter.')], ephemeral: true }) }
  },
}

// ── /voteskip ─────────────────────────────────────────────────────────────────
const voteMap = new Map<string, Set<string>>()
export const voteskip: Command = {
  data: new SlashCommandBuilder().setName('voteskip').setDescription('Vote to skip the current track'),
  voiceOnly: true,
  async execute(client, interaction) {
    const guildId = interaction.guildId!
    const p = client.musicService.getPlayer(guildId)
    if (!p?.queue.current) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const settings = await client.musicService.getGuildSettings(guildId)
    if (!settings?.voteSkipEnabled) return interaction.reply({ embeds: [buildErrorEmbed('Vote skip is disabled. Use `/skip` instead.')], ephemeral: true })
    const botVC = interaction.guild?.members.me?.voice.channel
    if (!botVC) return interaction.reply({ embeds: [buildErrorEmbed('Bot not in voice.')], ephemeral: true })
    const listeners = botVC.members.filter(m => !m.user.bot).size
    const threshold = settings?.voteSkipThreshold ?? 0.5
    const needed = Math.ceil(listeners * threshold)
    if (!voteMap.has(guildId)) voteMap.set(guildId, new Set())
    const votes = voteMap.get(guildId)!
    if (votes.has(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Already voted.')], ephemeral: true })
    votes.add(interaction.user.id)
    if (votes.size >= needed) {
      voteMap.delete(guildId); await p.skip()
      await client.musicService.publishPlayerState(guildId, p)
      return interaction.reply({ embeds: [buildSuccessEmbed(`Vote skip passed (${votes.size}/${needed}) ⏭️`)] })
    }
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('🗳️ Vote Skip').setDescription(`**${interaction.user.displayName}** voted to skip **${p.queue.current.title.slice(0,60)}**`).addFields({ name: 'Votes', value: `${votes.size} / ${needed}`, inline: true }, { name: 'Listeners', value: `${listeners}`, inline: true })] })
  },
}

// ── /history ──────────────────────────────────────────────────────────────────
export const history: Command = {
  data: new SlashCommandBuilder().setName('history').setDescription('View recently played tracks')
    .addIntegerOption(o => o.setName('limit').setDescription('Number of tracks (1–20)').setMinValue(1).setMaxValue(20)),
  async execute(client, interaction) {
    await interaction.deferReply()
    const limit = interaction.options.getInteger('limit') ?? 10
    const hist = await prisma.musicHistory.findMany({ where: { guildId: interaction.guildId! }, orderBy: { playedAt: 'desc' }, take: limit, include: { user: { select: { username: true } } } })
    if (!hist.length) return interaction.editReply({ embeds: [buildErrorEmbed('No music history yet.')] })
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('📜 Music History').setDescription(hist.map((h, i) => `\`${i+1}.\` **${h.title.slice(0,50)}** · \`${fmtMs(h.duration)}\`\n↳ ${h.author} · by **${h.user.username}** · <t:${Math.floor(new Date(h.playedAt).getTime()/1000)}:R>`).join('\n\n')).setFooter({ text: `Last ${hist.length} tracks` })] })
  },
}

// ── /favorites ────────────────────────────────────────────────────────────────
export const favorites: Command = {
  data: new SlashCommandBuilder().setName('favorites').setDescription('Manage your favorite tracks')
    .addSubcommand(s => s.setName('add').setDescription('Add current track to favorites'))
    .addSubcommand(s => s.setName('list').setDescription('List your favorites'))
    .addSubcommand(s => s.setName('play').setDescription('Queue all your favorites'))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a favorite').addIntegerOption(o => o.setName('position').setDescription('Position').setRequired(true).setMinValue(1))),
  async execute(client, interaction) {
    await interaction.deferReply({ ephemeral: true })
    const sub = interaction.options.getSubcommand(), userId = interaction.user.id
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId, username: interaction.user.displayName }, update: { username: interaction.user.displayName } })

    if (sub === 'add') {
      const p = client.musicService.getPlayer(interaction.guildId!)
      if (!p?.queue.current) return interaction.editReply({ embeds: [buildErrorEmbed('Nothing is playing.')] })
      const t = p.queue.current
      try {
        await prisma.favorite.upsert({ where: { userId_uri: { userId, uri: t.uri! } }, create: { userId, title: t.title, author: t.author ?? 'Unknown', duration: t.length ?? 0, thumbnail: t.thumbnail ?? undefined, uri: t.uri!, sourceType: ((t as any).sourceType ?? 'YOUTUBE') as any }, update: {} })
        await interaction.editReply({ embeds: [buildSuccessEmbed(`Added **${t.title}** to favorites ❤️`)] })
      } catch { await interaction.editReply({ embeds: [buildErrorEmbed('Already in favorites.')] }) }

    } else if (sub === 'list') {
      const favs = await prisma.favorite.findMany({ where: { userId }, orderBy: { addedAt: 'desc' }, take: 20 })
      if (!favs.length) return interaction.editReply({ embeds: [buildErrorEmbed('No favorites saved.')] })
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF6B9D').setTitle('❤️ Your Favorites').setDescription(favs.map((f, i) => `\`${i+1}.\` **${f.title.slice(0,50)}** · \`${fmtMs(f.duration)}\`\n↳ ${f.author}`).join('\n')).setFooter({ text: `${favs.length} saved tracks` })] })

    } else if (sub === 'play') {
      const favs = await prisma.favorite.findMany({ where: { userId }, orderBy: { addedAt: 'desc' }, take: 50 })
      if (!favs.length) return interaction.editReply({ embeds: [buildErrorEmbed('No favorites to play.')] })
      const member = interaction.guild?.members.cache.get(userId)
      if (!member?.voice.channel) return interaction.editReply({ embeds: [buildErrorEmbed('Join a voice channel first.')] })
      let player = client.musicService.getPlayer(interaction.guildId!)
      if (!player) player = await client.musicService.createPlayer({ guildId: interaction.guildId!, voiceId: member.voice.channel.id, textId: interaction.channelId })
      let added = 0
      for (const fav of favs) {
        try { const r = await client.kazagumo.search(fav.uri, { requester: interaction.user }); if (r.tracks[0]) { player.queue.add(r.tracks[0]); added++ } } catch {}
      }
      if (!player.playing) await player.play()
      await client.musicService.publishPlayerState(interaction.guildId!, player)
      await interaction.editReply({ embeds: [buildSuccessEmbed(`Queued **${added}** favorites ❤️`)] })

    } else if (sub === 'remove') {
      const pos = interaction.options.getInteger('position', true) - 1
      const favs = await prisma.favorite.findMany({ where: { userId }, orderBy: { addedAt: 'desc' }, skip: pos, take: 1 })
      if (!favs[0]) return interaction.editReply({ embeds: [buildErrorEmbed('Invalid position.')] })
      await prisma.favorite.delete({ where: { id: favs[0].id } })
      await interaction.editReply({ embeds: [buildSuccessEmbed(`Removed **${favs[0].title}** from favorites`)] })
    }
  },
}

// ── /playlist ─────────────────────────────────────────────────────────────────
export const playlist: Command = {
  data: new SlashCommandBuilder().setName('playlist').setDescription('Manage playlists')
    .addSubcommand(s => s.setName('save').setDescription('Save current queue as playlist').addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true)).addBooleanOption(o => o.setName('guild').setDescription('Save as server playlist')))
    .addSubcommand(s => s.setName('load').setDescription('Load a playlist into queue').addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('list').setDescription('List your playlists'))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a playlist').addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true))),
  async execute(client, interaction) {
    await interaction.deferReply({ ephemeral: true })
    const sub = interaction.options.getSubcommand(), userId = interaction.user.id, guildId = interaction.guildId!
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId, username: interaction.user.displayName }, update: { username: interaction.user.displayName } })

    if (sub === 'save') {
      const p = client.musicService.getPlayer(guildId)
      if (!p?.queue.current && !p?.queue.size) return interaction.editReply({ embeds: [buildErrorEmbed('Queue is empty.')] })
      const name = interaction.options.getString('name', true), isGuild = interaction.options.getBoolean('guild') ?? false
      const tracks = [...(p?.queue.current ? [p.queue.current] : []), ...(p?.queue ?? [])]
      if (await prisma.playlist.findFirst({ where: { name, userId } })) return interaction.editReply({ embeds: [buildErrorEmbed(`Playlist **${name}** already exists.`)] })
      await prisma.playlist.create({ data: { name, userId, guildId: isGuild ? guildId : undefined, isGuild, trackCount: tracks.length, tracks: { create: tracks.map((t, i) => ({ position: i, title: t.title, author: t.author ?? 'Unknown', duration: t.length ?? 0, thumbnail: t.thumbnail ?? undefined, uri: t.uri!, sourceType: ((t as any).sourceType ?? 'YOUTUBE') as any })) } } })
      await interaction.editReply({ embeds: [buildSuccessEmbed(`Saved **${tracks.length} tracks** as **${name}** 💾`)] })

    } else if (sub === 'load') {
      const name = interaction.options.getString('name', true)
      const pl = await prisma.playlist.findFirst({ where: { name, OR: [{ userId }, { guildId, isGuild: true }] }, include: { tracks: { orderBy: { position: 'asc' } } } })
      if (!pl) return interaction.editReply({ embeds: [buildErrorEmbed(`Playlist **${name}** not found.`)] })
      const member = interaction.guild?.members.cache.get(userId)
      if (!member?.voice.channel) return interaction.editReply({ embeds: [buildErrorEmbed('Join a voice channel first.')] })
      let player = client.musicService.getPlayer(guildId)
      if (!player) player = await client.musicService.createPlayer({ guildId, voiceId: member.voice.channel.id, textId: interaction.channelId })
      let added = 0
      for (const t of pl.tracks) {
        try { const r = await client.kazagumo.search(t.uri, { requester: interaction.user }); if (r.tracks[0]) { player.queue.add(r.tracks[0]); added++ } } catch {}
      }
      if (!player.playing) await player.play()
      await client.musicService.publishPlayerState(guildId, player)
      await interaction.editReply({ embeds: [buildSuccessEmbed(`Queued **${added}** tracks from **${name}** 🎵`)] })

    } else if (sub === 'list') {
      const pls = await prisma.playlist.findMany({ where: { OR: [{ userId }, { guildId, isGuild: true }] }, orderBy: { updatedAt: 'desc' } })
      if (!pls.length) return interaction.editReply({ embeds: [buildErrorEmbed('No playlists found.')] })
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('📀 Playlists').setDescription(pls.map(p => `**${p.name}** · ${p.trackCount} tracks · ${p.isGuild ? '🌐 Server' : '🔒 Personal'}`).join('\n')).setFooter({ text: `${pls.length} playlists` })] })

    } else if (sub === 'delete') {
      const name = interaction.options.getString('name', true)
      const pl = await prisma.playlist.findFirst({ where: { name, OR: [{ userId }, { guildId, isGuild: true }] } })
      if (!pl) return interaction.editReply({ embeds: [buildErrorEmbed(`Playlist **${name}** not found.`)] })
      if (pl.isGuild && pl.userId !== userId) {
        const isAdmin = interaction.guild?.members.cache.get(userId)?.permissions.has('ManageGuild')
        if (!isAdmin) return interaction.editReply({ embeds: [buildErrorEmbed('Only the creator or an admin can delete server playlists.')] })
      }
      await prisma.playlist.delete({ where: { id: pl.id } })
      await interaction.editReply({ embeds: [buildSuccessEmbed(`Deleted **${name}** 🗑️`)] })
    }
  },
  async autocomplete(client, interaction) {
    const q = interaction.options.getFocused(), userId = interaction.user.id, guildId = interaction.guildId!
    const pls = await prisma.playlist.findMany({ where: { OR: [{ userId }, { guildId, isGuild: true }], name: { contains: q, mode: 'insensitive' } }, take: 10 })
    await interaction.respond(pls.map(p => ({ name: `${p.name} (${p.trackCount} tracks)`, value: p.name })))
  },
}

// ── /settings ─────────────────────────────────────────────────────────────────
export const settings: Command = {
  data: new SlashCommandBuilder().setName('settings').setDescription('View or reset server settings')
    .addSubcommand(s => s.setName('view').setDescription('View current settings'))
    .addSubcommand(s => s.setName('reset').setDescription('Reset all settings to defaults')),
  djOnly: true,
  async execute(client, interaction) {
    await interaction.deferReply({ ephemeral: true })
    const sub = interaction.options.getSubcommand(), guildId = interaction.guildId!
    if (sub === 'view') {
      const s = await client.musicService.getGuildSettings(guildId)
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(s?.embedColor ?? '#5865F2').setTitle('⚙️ Server Settings').addFields(
        { name: 'Default Volume', value: `${s?.defaultVolume ?? 80}%`, inline: true },
        { name: 'Max Volume', value: `${s?.maxVolume ?? 150}%`, inline: true },
        { name: 'Loop', value: s?.defaultLoop ?? 'OFF', inline: true },
        { name: 'Autoplay', value: s?.autoplay ? '✅' : '❌', inline: true },
        { name: '24/7', value: s?.stay247 ? '✅' : '❌', inline: true },
        { name: 'DJ Only', value: s?.djOnlyMode ? '✅' : '❌', inline: true },
        { name: 'Vote Skip', value: s?.voteSkipEnabled ? `✅ ${Math.round((s.voteSkipThreshold ?? 0.5)*100)}%` : '❌', inline: true },
        { name: 'Max Queue', value: `${s?.maxQueueSize ?? 500}`, inline: true },
        { name: 'Search', value: s?.searchProvider ?? 'YOUTUBE_MUSIC', inline: true },
      )] })
    } else {
      const member = interaction.guild?.members.cache.get(interaction.user.id)
      if (!member?.permissions.has('ManageGuild')) return interaction.editReply({ embeds: [buildErrorEmbed('You need Manage Server permission.')] })
      await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId }, update: { defaultVolume: 80, maxVolume: 150, defaultLoop: 'OFF', autoplay: false, stay247: false, djRoleIds: [], djOnlyMode: false, voteSkipEnabled: true, voteSkipThreshold: 0.5, embedColor: '#5865F2', maxQueueSize: 500, maxSongDuration: 0, searchProvider: 'YOUTUBE_MUSIC' } })
      await client.musicService.invalidateSettingsCache(guildId)
      await interaction.editReply({ embeds: [buildSuccessEmbed('Settings reset to defaults.')] })
    }
  },
}

// ── /botstats (owner only) ────────────────────────────────────────────────────
export const botstats: Command = {
  data: new SlashCommandBuilder().setName('botstats').setDescription('Global bot statistics (owner only)'),
  async execute(client, interaction) {
    const ownerIds = (process.env.OWNER_IDS ?? '').split(',').map(s => s.trim())
    if (!ownerIds.includes(interaction.user.id)) return interaction.reply({ embeds: [buildErrorEmbed('Owner only.')], ephemeral: true })
    await interaction.deferReply({ ephemeral: true })
    const [guildCount, userCount, cmdCount] = await Promise.all([prisma.guild.count(), prisma.user.count(), prisma.commandLog.count()])
    const mem = process.memoryUsage()
    const nodes = [...client.kazagumo.shoukaku.nodes.values()].map(n => ({ name: n.name, connected: n.state === 1, players: n.stats?.players ?? 0, playing: n.stats?.playingPlayers ?? 0 }))
    const uptimeSec = Math.floor((Date.now() - client.startTime) / 1000)
    const uptime = `${Math.floor(uptimeSec/86400)}d ${Math.floor((uptimeSec%86400)/3600)}h ${Math.floor((uptimeSec%3600)/60)}m`
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('📊 Harmonia Stats').addFields(
      { name: '🌐 Guilds', value: guildCount.toString(), inline: true }, { name: '👤 Users', value: userCount.toString(), inline: true },
      { name: '🎵 Players', value: client.kazagumo.players.size.toString(), inline: true },
      { name: '⚡ Commands', value: cmdCount.toLocaleString(), inline: true }, { name: '⏱️ Uptime', value: uptime, inline: true },
      { name: '🏓 Ping', value: `${client.ws.ping}ms`, inline: true },
      { name: '💾 Heap', value: `${(mem.heapUsed/1024/1024).toFixed(1)}MB`, inline: true }, { name: '📦 Node', value: process.version, inline: true },
      { name: '🎛️ Lavalink', value: nodes.map(n => `${n.connected ? '🟢' : '🔴'} **${n.name}** — ${n.playing}/${n.players}`).join('\n') || 'None' },
    ).setTimestamp()] })
  },
}
