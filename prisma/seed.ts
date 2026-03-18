import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const ownerIds = (process.env.OWNER_IDS ?? '').split(',').filter(Boolean)
  for (const id of ownerIds) {
    await prisma.user.upsert({ where: { id }, create: { id, username: 'Owner', isOwner: true }, update: { isOwner: true } })
    console.log(`✓ Owner: ${id}`)
  }
  console.log('✅ Seed complete')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
