import { SlashCommandBuilder, EmbedBuilder } from 'discord.js'
import type { Command } from '../../types/index'
import { buildErrorEmbed, buildSuccessEmbed, buildQueueEmbed, buildNowPlayingEmbed, buildPlayerControls, buildSecondaryControls } from '../../utils/embeds'

// ── /pause ────────────────────────────────────────────────────────────────────
export const pause: Command = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current track'),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p?.playing || p.paused) return interaction.reply({ embeds: [buildErrorEmbed(!p ? 'Nothing is playing.' : 'Already paused.')], ephemeral: true })
    await p.pause(true)
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed('Paused ⏸️')] })
  },
}

// ── /resume ───────────────────────────────────────────────────────────────────
export const resume: Command = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p?.paused) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is paused.')], ephemeral: true })
    await p.pause(false)
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed('Resumed ▶️')] })
  },
}

// ── /skip ─────────────────────────────────────────────────────────────────────
export const skip: Command = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track')
    .addIntegerOption(o => o.setName('amount').setDescription('Skip multiple tracks').setMinValue(1).setMaxValue(50)),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p?.queue.current) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const amount = interaction.options.getInteger('amount') ?? 1
    if (amount > 1) p.queue.splice(0, amount - 1)
    await p.skip()
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Skipped ${amount > 1 ? `${amount} tracks` : 'track'} ⏭️`)] })
  },
}

// ── /stop ─────────────────────────────────────────────────────────────────────
export const stop: Command = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop music and clear queue'),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    p.queue.clear(); await p.skip()
    await client.musicService.publishPlayerState(interaction.guildId!, null)
    await interaction.reply({ embeds: [buildSuccessEmbed('Stopped and cleared queue ⏹️')] })
  },
}

// ── /queue ────────────────────────────────────────────────────────────────────
export const queue: Command = {
  data: new SlashCommandBuilder().setName('queue').setDescription('View the current queue')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)),
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p?.queue.current) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const s = await client.musicService.getGuildSettings(interaction.guildId!)
    await interaction.reply({ embeds: [buildQueueEmbed(p, (interaction.options.getInteger('page') ?? 1) - 1, s?.embedColor)] })
  },
}

// ── /nowplaying ───────────────────────────────────────────────────────────────
export const nowplaying: Command = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show current track'),
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p?.queue.current) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const s = await client.musicService.getGuildSettings(interaction.guildId!)
    await interaction.reply({ embeds: [buildNowPlayingEmbed(p, p.queue.current, s?.embedColor)], components: [buildPlayerControls(p.paused), buildSecondaryControls(p.loop, (p as any).autoplay ?? false)] })
  },
}

// ── /volume ───────────────────────────────────────────────────────────────────
export const volume: Command = {
  data: new SlashCommandBuilder().setName('volume').setDescription('Set playback volume')
    .addIntegerOption(o => o.setName('level').setDescription('1–150').setRequired(true).setMinValue(1).setMaxValue(150)),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const s = await client.musicService.getGuildSettings(interaction.guildId!)
    const level = Math.min(interaction.options.getInteger('level', true), s?.maxVolume ?? 150)
    await p.setVolume(level)
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Volume set to **${level}%** 🔊`)] })
  },
}

// ── /seek ─────────────────────────────────────────────────────────────────────
export const seek: Command = {
  data: new SlashCommandBuilder().setName('seek').setDescription('Seek to a position')
    .addStringOption(o => o.setName('position').setDescription('e.g. 1:30 or 90').setRequired(true)),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p?.queue.current) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const pos = interaction.options.getString('position', true)
    let ms = 0
    if (pos.includes(':')) { const parts = pos.split(':').map(Number); ms = parts.length === 3 ? (parts[0]*3600+parts[1]*60+parts[2])*1000 : (parts[0]*60+parts[1])*1000 }
    else ms = parseInt(pos) * 1000
    if (ms < 0 || ms > (p.queue.current.length ?? 0)) return interaction.reply({ embeds: [buildErrorEmbed('Position out of range.')], ephemeral: true })
    await p.shoukaku.seekTo(ms)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Seeked to **${pos}** ⏩`)] })
  },
}

// ── /shuffle ──────────────────────────────────────────────────────────────────
export const shuffle: Command = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue'),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p || p.queue.size < 2) return interaction.reply({ embeds: [buildErrorEmbed('Not enough tracks to shuffle.')], ephemeral: true })
    p.queue.shuffle()
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Queue shuffled 🔀 (${p.queue.size} tracks)`)] })
  },
}

// ── /loop ─────────────────────────────────────────────────────────────────────
export const loop: Command = {
  data: new SlashCommandBuilder().setName('loop').setDescription('Set loop mode')
    .addStringOption(o => o.setName('mode').setDescription('Loop mode').setRequired(true)
      .addChoices({ name: 'Off', value: 'none' }, { name: 'Track', value: 'track' }, { name: 'Queue', value: 'queue' })),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const mode = interaction.options.getString('mode', true) as 'none'|'track'|'queue'
    p.setLoop(mode)
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Loop: **${{ none:'Off ➡️', track:'Track 🔂', queue:'Queue 🔁' }[mode]}**`)] })
  },
}

// ── /remove ───────────────────────────────────────────────────────────────────
export const remove: Command = {
  data: new SlashCommandBuilder().setName('remove').setDescription('Remove a track from queue')
    .addIntegerOption(o => o.setName('position').setDescription('Queue position').setRequired(true).setMinValue(1)),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p || !p.queue.size) return interaction.reply({ embeds: [buildErrorEmbed('Queue is empty.')], ephemeral: true })
    const pos = interaction.options.getInteger('position', true) - 1
    if (pos >= p.queue.size) return interaction.reply({ embeds: [buildErrorEmbed('Invalid position.')], ephemeral: true })
    const [removed] = p.queue.splice(pos, 1)
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Removed **${removed.title}**`)] })
  },
}

// ── /clear ────────────────────────────────────────────────────────────────────
export const clear: Command = {
  data: new SlashCommandBuilder().setName('clear').setDescription('Clear the queue (keeps current track)'),
  voiceOnly: true, djOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p || !p.queue.size) return interaction.reply({ embeds: [buildErrorEmbed('Queue is already empty.')], ephemeral: true })
    const size = p.queue.size; p.queue.clear()
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Cleared **${size}** tracks 🗑️`)] })
  },
}

// ── /disconnect ───────────────────────────────────────────────────────────────
export const disconnect: Command = {
  data: new SlashCommandBuilder().setName('disconnect').setDescription('Disconnect from voice'),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p) return interaction.reply({ embeds: [buildErrorEmbed('Not in a voice channel.')], ephemeral: true })
    await p.destroy()
    await client.musicService.publishPlayerState(interaction.guildId!, null)
    await interaction.reply({ embeds: [buildSuccessEmbed('Disconnected 👋')] })
  },
}

// ── /move ─────────────────────────────────────────────────────────────────────
export const move: Command = {
  data: new SlashCommandBuilder().setName('move').setDescription('Move a track in the queue')
    .addIntegerOption(o => o.setName('from').setDescription('Current position').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('to').setDescription('Target position').setRequired(true).setMinValue(1)),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p || p.queue.size < 2) return interaction.reply({ embeds: [buildErrorEmbed('Not enough tracks.')], ephemeral: true })
    const from = interaction.options.getInteger('from', true) - 1
    const to   = interaction.options.getInteger('to', true)   - 1
    if (from >= p.queue.size || to >= p.queue.size) return interaction.reply({ embeds: [buildErrorEmbed('Position out of range.')], ephemeral: true })
    const [track] = p.queue.splice(from, 1)
    p.queue.splice(to, 0, track)
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Moved **${track.title}** to position **${to+1}**`)] })
  },
}

// ── /jump ─────────────────────────────────────────────────────────────────────
export const jump: Command = {
  data: new SlashCommandBuilder().setName('jump').setDescription('Jump to a queue position')
    .addIntegerOption(o => o.setName('position').setDescription('Position').setRequired(true).setMinValue(1)),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p || !p.queue.size) return interaction.reply({ embeds: [buildErrorEmbed('Queue is empty.')], ephemeral: true })
    const pos = interaction.options.getInteger('position', true) - 1
    if (pos >= p.queue.size) return interaction.reply({ embeds: [buildErrorEmbed('Position out of range.')], ephemeral: true })
    p.queue.splice(0, pos); await p.skip()
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Jumped to position **${pos+1}**`)] })
  },
}

// ── /replay ───────────────────────────────────────────────────────────────────
export const replay: Command = {
  data: new SlashCommandBuilder().setName('replay').setDescription('Replay current track from start'),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p?.queue.current) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    await p.shoukaku.seekTo(0)
    await interaction.reply({ embeds: [buildSuccessEmbed('Replaying 🔄')] })
  },
}

// ── /autoplay ─────────────────────────────────────────────────────────────────
export const autoplay: Command = {
  data: new SlashCommandBuilder().setName('autoplay').setDescription('Toggle autoplay mode'),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })
    const cur = (p as any).autoplay ?? false
    ;(p as any).autoplay = !cur
    await client.musicService.publishPlayerState(interaction.guildId!, p)
    await interaction.reply({ embeds: [buildSuccessEmbed(`Autoplay **${!cur ? 'enabled ✨' : 'disabled'}**`)] })
  },
}

// ── /247 ──────────────────────────────────────────────────────────────────────
export const stay247: Command = {
  data: new SlashCommandBuilder().setName('247').setDescription('Toggle 24/7 mode'),
  voiceOnly: true, djOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p) return interaction.reply({ embeds: [buildErrorEmbed('Not in a voice channel.')], ephemeral: true })
    const cur = (p as any).stay247 ?? false
    ;(p as any).stay247 = !cur
    await interaction.reply({ embeds: [buildSuccessEmbed(`24/7 mode **${!cur ? 'enabled 🔒' : 'disabled'}**`)] })
  },
}
