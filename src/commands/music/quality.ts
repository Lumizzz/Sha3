import { SlashCommandBuilder, EmbedBuilder } from 'discord.js'
import type { Command } from '../../types/index'
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds'

// Quality presets map to Lavalink equalizer + timescale adjustments
const QUALITY_PRESETS: Record<string, {
  label: string
  description: string
  emoji: string
  filters: object
}> = {
  low: {
    label: 'Low (64kbps equivalent)',
    description: 'Saves bandwidth, lower fidelity',
    emoji: '🔇',
    filters: {
      equalizer: [
        { band: 0, gain: -0.2 }, { band: 1, gain: -0.2 }, { band: 2, gain: -0.1 },
        { band: 3, gain: 0 }, { band: 4, gain: 0 }, { band: 5, gain: -0.1 },
        { band: 6, gain: -0.1 }, { band: 7, gain: -0.1 }, { band: 8, gain: -0.1 },
      ],
    },
  },
  medium: {
    label: 'Medium (128kbps equivalent)',
    description: 'Balanced quality and performance',
    emoji: '📻',
    filters: {},
  },
  high: {
    label: 'High (192kbps equivalent)',
    description: 'Good quality for most listeners',
    emoji: '🎵',
    filters: {
      equalizer: [
        { band: 0, gain: 0.1 }, { band: 1, gain: 0.1 }, { band: 2, gain: 0.05 },
        { band: 3, gain: 0 }, { band: 4, gain: 0 }, { band: 5, gain: 0.05 },
        { band: 6, gain: 0.1 }, { band: 7, gain: 0.1 }, { band: 8, gain: 0.1 },
      ],
    },
  },
  veryhigh: {
    label: 'Very High (256kbps equivalent)',
    description: 'Great quality with enhanced audio',
    emoji: '🎶',
    filters: {
      equalizer: [
        { band: 0, gain: 0.15 }, { band: 1, gain: 0.15 }, { band: 2, gain: 0.1 },
        { band: 3, gain: 0.05 }, { band: 4, gain: 0 }, { band: 5, gain: 0.05 },
        { band: 6, gain: 0.1 }, { band: 7, gain: 0.15 }, { band: 8, gain: 0.2 },
        { band: 9, gain: 0.2 }, { band: 10, gain: 0.15 }, { band: 11, gain: 0.1 },
        { band: 12, gain: 0.1 },
      ],
    },
  },
  best: {
    label: 'Best (320kbps equivalent)',
    description: 'Maximum quality — enhanced highs and lows',
    emoji: '💎',
    filters: {
      equalizer: [
        { band: 0, gain: 0.2 }, { band: 1, gain: 0.2 }, { band: 2, gain: 0.15 },
        { band: 3, gain: 0.1 }, { band: 4, gain: 0.05 }, { band: 5, gain: 0 },
        { band: 6, gain: 0.05 }, { band: 7, gain: 0.1 }, { band: 8, gain: 0.15 },
        { band: 9, gain: 0.2 }, { band: 10, gain: 0.2 }, { band: 11, gain: 0.2 },
        { band: 12, gain: 0.2 },
      ],
    },
  },
}

export const quality: Command = {
  data: new SlashCommandBuilder()
    .setName('quality')
    .setDescription('Set audio quality preset')
    .addStringOption(o =>
      o.setName('preset')
        .setDescription('Quality preset')
        .setRequired(true)
        .addChoices(
          { name: '🔇 Low (64kbps)', value: 'low' },
          { name: '📻 Medium (128kbps)', value: 'medium' },
          { name: '🎵 High (192kbps)', value: 'high' },
          { name: '🎶 Very High (256kbps)', value: 'veryhigh' },
          { name: '💎 Best (320kbps)', value: 'best' },
        )
    ),
  voiceOnly: true,
  async execute(client, interaction) {
    const p = client.musicService.getPlayer(interaction.guildId!)
    if (!p) return interaction.reply({ embeds: [buildErrorEmbed('Nothing is playing.')], ephemeral: true })

    const preset = interaction.options.getString('preset', true)
    const config = QUALITY_PRESETS[preset]
    if (!config) return interaction.reply({ embeds: [buildErrorEmbed('Invalid preset.')], ephemeral: true })

    try {
      await p.shoukaku.setFilters(config.filters)
      ;(p as any).currentQuality = preset

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`${config.emoji} Quality set to ${config.label}`)
            .setDescription(config.description)
            .addFields(
              { name: '🎚️ Preset', value: config.label, inline: true },
              { name: '🎵 Now Playing', value: p.queue.current?.title?.slice(0, 50) ?? 'Nothing', inline: true },
            )
            .setFooter({ text: 'Quality is applied via equalizer adjustments on the Lavalink node' })
        ],
      })
    } catch {
      await interaction.reply({ embeds: [buildErrorEmbed('Failed to set quality. Try again.')], ephemeral: true })
    }
  },
}
