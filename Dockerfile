FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json .npmrc* ./
RUN npm install

# Copy source and build
COPY . .
RUN ./node_modules/.bin/prisma generate && ./node_modules/.bin/tsc -p tsconfig.json

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy built files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/index.js ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.BOT_API_PORT||4000) + '/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

EXPOSE 4000
CMD ["node", "--max-old-space-size=400", "--expose-gc", "index.js"]
