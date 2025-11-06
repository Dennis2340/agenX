import { tool } from '@openai/agents'
import { z } from 'zod'
import { prisma } from '../db'

// Simple web search tool using Tavily API if available
export const webSearchTool = tool({
  name: 'web_search',
  description: 'Search the web for relevant information using Tavily. Returns a concise JSON of top results.',
  parameters: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(5).default(3)
  }),
  execute: async ({ query, limit }) => {
    const key = process.env.TAVILY_API_KEY
    if (!key) {
      return { results: [] }
    }
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: limit })
    })
    if (!res.ok) return { results: [] }
    const data = await res.json()
    // Normalize a bit
    const items = (data?.results || []).slice(0, limit).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet || r.content || ''
    }))
    return { results: items }
  }
})

// Parse a URL: fetch and return plain text (very naive fallback)
export const parseUrlTool = tool({
  name: 'parse_url',
  description: 'Fetch a URL and return extracted plain text (basic). Use for quick summaries.',
  parameters: z.object({ url: z.string().url() }),
  execute: async ({ url }) => {
    try {
      const res = await fetch(url)
      const html = await res.text()
      const text = String(html)
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return { text: text.slice(0, 20000) }
    } catch {
      return { text: '' }
    }
  }
})

// Save a text blob to a pseudo Drive (stub). In MVP, just store as Document row; integrate Google Drive later.
export const saveToDriveTool = tool({
  name: 'save_to_drive',
  description: 'Save final output to storage. MVP: store as Document row; later, push to Google Drive.',
  parameters: z.object({
    userId: z.string().min(1),
    name: z.string().min(1),
    content: z.string().min(1)
  }),
  execute: async ({ userId, name, content }) => {
    const doc = await prisma.document.create({
      data: {
        userId,
        type: 'TEXT',
        storage: 'WEB',
        url: null,
        driveFileId: null,
        extractedText: content,
      }
    })
    return { documentId: doc.id, name }
  }
})

// Notify a Discord channel via webhook
export const notifyDiscordTool = tool({
  name: 'notify_discord',
  description: 'Send a message to a Discord channel via webhook URL.',
  parameters: z.object({
    webhookUrl: z.string().url(),
    message: z.string().min(1)
  }),
  execute: async ({ webhookUrl, message }) => {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message })
      })
      return { ok: res.ok }
    } catch {
      return { ok: false }
    }
  }
})
