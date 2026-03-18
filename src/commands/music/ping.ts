import { SlashCommandBuilder, EmbedBuilder } from 'discord.js'
import type { Command } from '../../types/index'

export const ping: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check bot latency and status'),
  async execute(client, interaction) {
    const start = Date.now()
    await interaction.deferReply()
    const latency = Date.now() - start
    const wsLatency = client.ws.ping
    const uptime = Date.now() - client.startTime
    const uptimeSec = Math.floor(uptime / 1000)
    const uptimeStr = `${Math.floor(uptimeSec/86400)}d ${Math.floor((uptimeSec%86400)/3600)}h ${Math.floor((uptimeSec%3600)/60)}m ${uptimeSec%60}s`
    const lavalinkNodes = [...client.kazagumo.shoukaku.nodes.values()]
    const lavalinkStatus = lavalinkNodes.map(n => `${n.state === 1 ? '🟢' : '🔴'} ${n.name}`).join('\n') || '❌ None'
    const color = wsLatency < 100 ? '#57F287' : wsLatency < 200 ? '#FEE75C' : '#ED4245'
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(color as any)
          .setTitle('🏓 Pong!')
          .addFields(
            { name: '📡 API Latency', value: `${latency}ms`, inline: true },
            { name: '💓 WS Heartbeat', value: `${wsLatency}ms`, inline: true },
            { name: '⏱️ Uptime', value: uptimeStr, inline: true },
            { name: '🎵 Active Players', value: `${client.kazagumo.players.size}`, inline: true },
            { name: '🌐 Servers', value: `${client.guilds.cache.size}`, inline: true },
            { name: '🎛️ Lavalink', value: lavalinkStatus, inline: true },
          )
          .setTimestamp()
      ]
    })
  },
}
