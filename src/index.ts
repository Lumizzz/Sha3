import 'dotenv/config'
import { HarmoniaClient } from './client'
import { logger } from './utils/logger'
import { startApiServer } from './api/server'

process.on('uncaughtException', err => {
  logger.fatal({ err }, 'Uncaught exception')
  // Don't exit on non-fatal uncaught exceptions from third-party libs
  if ((err as any).code === 1) return // KazagumoError
})
process.on('unhandledRejection', reason => logger.error({ reason }, 'Unhandled rejection'))

const client = new HarmoniaClient()
let shuttingDown = false

async function shutdown(sig: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info(`${sig} received — shutting down`)
  try { await client.destroy(); process.exit(0) }
  catch { process.exit(1) }
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

async function main() {
  logger.info('🎵 Starting Harmonia...')

  // Validate token format before attempting login
  const token = process.env.DISCORD_TOKEN
  if (!token || token === 'your_bot_token' || token.length < 50) {
    logger.fatal('❌ DISCORD_TOKEN is missing or invalid. Set it in your environment variables.')
    process.exit(1)
  }

  // Validate Redis URL
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl || redisUrl === 'your_redis_url') {
    logger.fatal('❌ REDIS_URL is missing or invalid. Set it in your environment variables.')
    process.exit(1)
  }

  await startApiServer(client)
  await client.login(token)
}

main().catch(err => {
  const msg = err?.message ?? String(err)
  if (msg.includes('TokenInvalid') || msg.includes('invalid token')) {
    logger.fatal('❌ Invalid Discord token — go to discord.com/developers, reset your bot token, and update DISCORD_TOKEN')
  } else {
    logger.fatal({ err }, 'Startup failed')
  }
  process.exit(1)
})
