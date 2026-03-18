const path = require('path')
const fs   = require('fs')
const v8   = require('v8')

// Cap heap at 400MB
try { v8.setFlagsFromString('--max-old-space-size=400') } catch {}

const distEntry = path.join(__dirname, 'dist', 'index.js')
if (!fs.existsSync(distEntry)) {
  console.error('❌ dist/index.js not found — build failed.')
  process.exit(1)
}

// Keepalive timer — prevents Wispbyte from killing the process on inactivity
const keepalive = setInterval(() => {
  const mem = process.memoryUsage()
  const used = Math.round(mem.heapUsed / 1024 / 1024)
  const total = Math.round(mem.heapTotal / 1024 / 1024)
  process.stdout.write(`[Harmonia] alive | heap ${used}/${total}MB\n`)
  if (global.gc) global.gc()
}, 30_000) // every 30 seconds

keepalive.unref() // don't block process exit on shutdown

require(distEntry)
