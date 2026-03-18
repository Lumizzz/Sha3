#!/usr/bin/env tsx
import 'dotenv/config'
import { REST, Routes } from 'discord.js'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'

async function main() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!)
  const commands: object[] = []
  const dir = join(__dirname, '..', 'commands')

  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry)
    const files = statSync(entryPath).isDirectory()
      ? readdirSync(entryPath).filter(f => f.endsWith('.ts') || f.endsWith('.js')).map(f => join(entryPath, f))
      : (entry.endsWith('.ts') || entry.endsWith('.js')) ? [entryPath] : []
    for (const filePath of files) {
      try {
        const mod = await import(filePath)
        for (const val of Object.values(mod)) {
          const c = val as any
          if (c?.data?.toJSON) { commands.push(c.data.toJSON()); console.log(`  ✓ ${c.data.name}`) }
        }
      } catch (err) { console.warn(`  ⚠ ${filePath}:`, err) }
    }
  }

  console.log(`\nDeploying ${commands.length} commands...`)
  const guildId = process.env.DISCORD_GUILD_ID
  const clientId = process.env.DISCORD_CLIENT_ID!

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
    console.log(`✅ Deployed to guild ${guildId} (instant)`)
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands })
    console.log('✅ Deployed globally (up to 1hr)')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
