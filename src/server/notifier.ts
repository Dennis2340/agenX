import { prisma } from '@/server/db'
import { sendDiscordMessage } from '@/server/integrations/discord'

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || ''
const FALLBACK_CHANNEL = process.env.DISCORD_CHANNEL_ID || ''

export async function notifyDiscordForUser(userId: string, content: string) {
  if (!BOT_TOKEN) return
  // Find user's preferred channel
  const setting = await prisma.userSetting.findUnique({ where: { userId } })
  const channelId = setting?.discordChannelId || FALLBACK_CHANNEL
  if (!channelId) return
  try {
    await sendDiscordMessage({ botToken: BOT_TOKEN, channelId, content })
  } catch (e) {
    // swallow notifier errors to avoid breaking main flow
  }
}
