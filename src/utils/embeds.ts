import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  type ColorResolvable,
} from 'discord.js'
import type { KazagumoPlayer, KazagumoTrack } from 'kazagumo'

const DEFAULT_COLOR = '#5865F2'

const SOURCE_COLORS: Record<string, string> = {
  YOUTUBE: '#FF0000',
  YOUTUBE_MUSIC: '#FF0000',
  SPOTIFY: '#1DB954',
  APPLE_MUSIC: '#FC3C44',
  SOUNDCLOUD: '#FF5500',
  TWITCH: '#9146FF',
  HTTP: '#5865F2',
  CUSTOM: '#5865F2',
}

const SOURCE_EMOJIS: Record<string, string> = {
  YOUTUBE: '▶️',
  YOUTUBE_MUSIC: '🎵',
  SPOTIFY: '🎵',
  APPLE_MUSIC: '🎵',
  SOUNDCLOUD: '☁️',
  TWITCH: '📺',
  HTTP: '🔗',
  CUSTOM: '📀',
}

export function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

function progressBar(pos: number, total: number, len = 15): string {
  if (!total) return '░'.repeat(len)
  const p = Math.min(Math.floor((pos / total) * len), len - 1)
  return '▓'.repeat(p) + '🔘' + '░'.repeat(len - p - 1)
}

function getLoopText(loop: string): string {
  if (loop === 'track') return '🔂 Track'
  if (loop === 'queue') return '🔁 Queue'
  return '➡️ Off'
}

export function buildNowPlayingEmbed(
  player: KazagumoPlayer,
  track: KazagumoTrack,
  color?: string
): EmbedBuilder {
  const src = (track as any).sourceType ?? 'YOUTUBE'
  const artwork = (track as any).artworkUrl ?? track.thumbnail
  const requester = (track.requester as any)?.username ?? 'Unknown'
  const requesterAvatar = (track.requester as any)?.displayAvatarURL?.() ?? null
  const bar = progressBar(player.position, track.length ?? 0)
  const embedColor = color ?? SOURCE_COLORS[src] ?? DEFAULT_COLOR
  const autoplay = (player as any).autoplay ?? false
  const is247 = (player as any).stay247 ?? false
  const quality = (player as any).currentQuality ?? 'medium'
  const qualityEmojis: Record<string,string> = { low:'🔇', medium:'📻', high:'🎵', veryhigh:'🎶', best:'💎' }

  const badges = [
    player.loop !== 'none' ? getLoopText(player.loop) : null,
    autoplay ? '✨ Auto' : null,
    is247 ? '🔒 24/7' : null,
    quality !== 'medium' ? `${qualityEmojis[quality]} ${quality}` : null,
  ].filter(Boolean).join('  •  ')

  return new EmbedBuilder()
    .setColor(embedColor as ColorResolvable)
    .setAuthor({
      name: `${SOURCE_EMOJIS[src] ?? '🎵'} Now Playing`,
      iconURL: requesterAvatar ?? undefined,
    })
    .setTitle(track.title.slice(0, 256))
    .setURL(track.uri ?? null)
    .setThumbnail(artwork ?? null)
    .setDescription(
      [
        `> **${track.title.slice(0, 80)}**`,
        `> 👤 ${track.author ?? 'Unknown Artist'}`,
        '',
        `${bar}`,
        `\`${fmtMs(player.position)}\` ${'─'.repeat(3)} \`${fmtMs(track.length ?? 0)}\``,
        badges ? `\n${badges}` : '',
      ].join('\n')
    )
    .addFields(
      { name: '🔊 Volume', value: `**${player.volume}%**`, inline: true },
      { name: '📋 Queue',  value: `**${player.queue.size}** track${player.queue.size !== 1 ? 's' : ''}`, inline: true },
      { name: '👤 Requested', value: `**${requester}**`, inline: true },
    )
    .setFooter({ text: `Harmonia Music  •  Use /quality to change audio quality` })
    .setTimestamp()
}

// ── Row 1: Transport ──────────────────────────────────────────────────────────
export function buildPlayerControls(isPaused: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('player:previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:rewind').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(isPaused ? 'player:resume' : 'player:pause')
      .setEmoji(isPaused ? '▶️' : '⏸️')
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('player:fastforward').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
  )
}

// ── Row 2: Volume + Queue ─────────────────────────────────────────────────────
export function buildSecondaryControls(loop: string, autoplay: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('player:volumedown').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('player:favorite').setEmoji('🤍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:queue').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:volumeup').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
  )
}

// ── Row 3: Extras ─────────────────────────────────────────────────────────────
export function buildExtraControls(loop: string, autoplay: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('player:lyrics').setEmoji('🎤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('player:loop')
      .setEmoji(loop === 'track' ? '🔂' : loop === 'queue' ? '🔁' : '↪️')
      .setStyle(loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('player:autoplay')
      .setEmoji('✨')
      .setStyle(autoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:nowplaying').setEmoji('📊').setStyle(ButtonStyle.Secondary),
  )
}

// ── Row 4: Quality Select ─────────────────────────────────────────────────────
export function buildQualitySelect(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('player:quality')
      .setPlaceholder('🎚️ Select Audio Quality')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('🔇 Low (64kbps)').setValue('low').setDescription('Saves bandwidth, lower fidelity'),
        new StringSelectMenuOptionBuilder().setLabel('📻 Medium (128kbps)').setValue('medium').setDescription('Balanced — default'),
        new StringSelectMenuOptionBuilder().setLabel('🎵 High (192kbps)').setValue('high').setDescription('Good quality'),
        new StringSelectMenuOptionBuilder().setLabel('🎶 Very High (256kbps)').setValue('veryhigh').setDescription('Great quality'),
        new StringSelectMenuOptionBuilder().setLabel('💎 Best (320kbps)').setValue('best').setDescription('Maximum quality'),
      )
  )
}

// ── Queue Embed ───────────────────────────────────────────────────────────────
export function buildQueueEmbed(player: KazagumoPlayer, page = 0, color = DEFAULT_COLOR): EmbedBuilder {
  const perPage = 10, start = page * perPage
  const tracks = player.queue.slice(start, start + perPage)
  const totalPages = Math.ceil(player.queue.size / perPage)
  const totalDuration = player.queue.reduce((a, t) => a + (t.length ?? 0), 0)
  const current = player.queue.current

  return new EmbedBuilder()
    .setColor(color as ColorResolvable)
    .setTitle('📋 Current Queue')
    .setDescription(
      (current
        ? `**▶️ Now Playing:**\n> [${current.title.slice(0,60)}](${current.uri}) • \`${fmtMs(current.length ?? 0)}\`\n\n`
        : '') +
      (tracks.length > 0
        ? tracks.map((t, i) =>
            `\`${String(start+i+1).padStart(2,' ')}.\` **[${t.title.slice(0,45)}](${t.uri})** • \`${fmtMs(t.length ?? 0)}\`\n` +
            `    └ 👤 ${(t.requester as any)?.username ?? 'Unknown'}`
          ).join('\n')
        : '*Queue is empty*')
    )
    .setFooter({ text: `Page ${page+1}/${Math.max(totalPages,1)}  •  ${player.queue.size} tracks  •  ${fmtMs(totalDuration)} total` })
    .setTimestamp()
}

export function buildErrorEmbed(msg: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor('#ED4245')
    .setDescription(`❌  ${msg}`)
}

export function buildSuccessEmbed(msg: string, color = DEFAULT_COLOR): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color as ColorResolvable)
    .setDescription(`✅  ${msg}`)
}
