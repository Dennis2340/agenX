import { NextRequest, NextResponse } from 'next/server'

const APP_ID = process.env.DISCORD_APP_ID || ''
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || ''
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || ''

function buildInviteUrl(appId: string) {
  // Minimal permissions: View Channels (1024), Send Messages (2048), Embed Links (16384), Attach Files (8192)
  // Combined = 1024 + 2048 + 16384 + 8192 = 27648
  const permissions = 27648
  const scope = encodeURIComponent('bot applications.commands')
  return `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=${permissions}&scope=${scope}`
}

export async function GET() {
  if (!APP_ID) {
    return NextResponse.json({ inviteUrl: null, error: 'DISCORD_APP_ID missing' }, { status: 200 })
  }
  return NextResponse.json({ inviteUrl: buildInviteUrl(APP_ID) })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(()=>({})) as any
    const content: string = body?.content || 'AgenX: test message'
    const token = (body?.botToken as string) || BOT_TOKEN
    const channelId = (body?.channelId as string) || CHANNEL_ID

    if (!token || !channelId) {
      return NextResponse.json({ error: 'Missing DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID' }, { status: 400 })
    }

    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    })
    const text = await res.text()
    if (!res.ok) {
      return NextResponse.json({ error: `Discord API ${res.status}: ${text}` }, { status: 400 })
    }
    try {
      return NextResponse.json(JSON.parse(text))
    } catch {
      return NextResponse.json({ ok: true })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to send test message' }, { status: 400 })
  }
}
