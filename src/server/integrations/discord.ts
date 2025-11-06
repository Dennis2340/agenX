export async function sendDiscordMessage(params: {
  botToken: string
  channelId: string
  content?: string
  embeds?: any[]
}) {
  const { botToken, channelId, content, embeds } = params
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: content || '', embeds })
  })
  if (!res.ok) {
    const text = await res.text().catch(()=>'')
    throw new Error(`Discord API error ${res.status}: ${text}`)
  }
  return res.json()
}
