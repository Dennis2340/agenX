import { prisma } from '@/server/db'
import { sendDiscordMessage } from '@/server/integrations/discord'

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || ''
const FALLBACK_CHANNEL = process.env.DISCORD_CHANNEL_ID || ''

export async function notifyDiscordForUser(userId: string, content: string) {
  const debug = process.env.DEBUG_DISCORD === '1'
  if (!BOT_TOKEN) {
    if (debug) console.warn('[notifier] skip: DISCORD_BOT_TOKEN missing')
    return
  }
  // Find user's preferred channel
  const setting = await prisma.userSetting.findUnique({ where: { userId } })
  const channelId = setting?.discordChannelId || FALLBACK_CHANNEL
  if (!channelId) {
    if (debug) console.warn('[notifier] skip: no discord channel for user and no FALLBACK_CHANNEL')
    return
  }
  try {
    await sendDiscordMessage({ botToken: BOT_TOKEN, channelId, content })
  } catch (e) {
    if (debug) console.warn('[notifier] send failed', { error: (e as any)?.message || String(e) })
    // swallow notifier errors to avoid breaking main flow
  }
}
