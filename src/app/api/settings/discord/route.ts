import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/server/db'
import { verifyToken } from '@/server/auth'

function getUserId(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || ''
  const [, token] = auth.split(' ')
  if (!token) return null
  const payload = verifyToken<{ id: string }>(token)
  return payload?.id || null
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const setting = await prisma.userSetting.findUnique({ where: { userId } })
  return NextResponse.json({ discordChannelId: setting?.discordChannelId || '' })
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const channelId = (body.channelId ?? '').toString().trim()
  const saved = await prisma.userSetting.upsert({
    where: { userId },
    update: { discordChannelId: channelId },
    create: { userId, discordChannelId: channelId },
  })
  return NextResponse.json({ discordChannelId: saved.discordChannelId || '' })
}
