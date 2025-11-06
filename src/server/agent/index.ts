import { Agent, run, tool } from '@openai/agents'
import { z } from 'zod'
import { prisma } from '../db'
import { fetchUrlText as fetchUrlTextRaw, askPerplexity as askPerplexityRaw, askTavily as askTavilyRaw } from '../tools/research'
import { getPaidFetcher } from '../payments/x402'

export function makeTools(taskId: string) {
  const paidFetch = getPaidFetcher()

  // Strict URL variant: requires url
  const fetchUrlTextUrl = tool({
    name: 'fetch_url_text_url',
    description: 'Fetch a URL and extract readable text content for grounding.',
    parameters: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      try {
        const text = await fetchUrlTextRaw(url, paidFetch)
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url }, output: { ok: !!text, length: text?.length || 0 }, success: !!text } }).catch(()=>null)
        return { ok: !!text, text: text || '' }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        return { ok: false, error: e?.message || 'failed' }
      }
    }
  })

  // Safe no-arg variant: never 400; logs and returns ok:false
  const fetchUrlText = tool({
    name: 'fetch_url_text',
    description: 'If no URL is provided, returns ok:false. Prefer fetch_url_text_url({ url }) when a URL exists.',
    parameters: z.object({}),
    execute: async () => {
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: null, tag: 'no_url' }, output: { ok: false, error: 'No URL provided' }, success: false } }).catch(()=>null)
      return { ok: false, error: 'No URL provided' }
    }
  })

  const researchPerplexity = tool({
    name: 'research_perplexity',
    description: 'Query Perplexity for concise, evidence-backed bullets for a topic.',
    parameters: z.object({ query: z.string().min(2) }),
    execute: async ({ query }) => {
      try {
        const out = await askPerplexityRaw(query, paidFetch)
        await prisma.toolRun.create({ data: { taskId, tool: 'PERPLEXITY', input: { query }, output: { ok: !!out }, success: !!out } }).catch(()=>null)
        return { ok: !!out, text: out || '' }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'PERPLEXITY', input: { query }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        return { ok: false, error: e?.message || 'failed' }
      }
    }
  })

  const researchTavily = tool({
    name: 'research_tavily',
    description: 'Search Tavily for web results and summarized answer.',
    parameters: z.object({ query: z.string().min(2) }),
    execute: async ({ query }) => {
      try {
        const out = await askTavilyRaw(query, paidFetch)
        await prisma.toolRun.create({ data: { taskId, tool: 'TAVILY', input: { query }, output: { ok: !!out }, success: !!out } }).catch(()=>null)
        return { ok: !!out, text: out || '' }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'TAVILY', input: { query }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        return { ok: false, error: e?.message || 'failed' }
      }
    }
  })

  const x402Demo = tool({
    name: 'x402_demo_call',
    description: 'Demonstrate a real x402-paid HTTP call to a demo endpoint.',
    parameters: z.object({}),
    execute: async () => {
      try {
        const res = await paidFetch('https://triton.api.corbits.dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { status: res.status, ok: res.ok }, success: res.ok } }).catch(()=>null)
        return { ok: res.ok, status: res.status }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        return { ok: false, error: (e as any)?.message || 'failed' }
      }
    }
  })

  return { fetchUrlText, fetchUrlTextUrl, researchPerplexity, researchTavily, x402Demo }
}

async function synthesizeFinal(instructions: string, context: { urlText?: string; perplexity?: string; tavily?: string }): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return ''
  const prompt = [
    instructions,
    '',
    'Context:',
    context.urlText ? `URL Text:\n${context.urlText}` : '(no url text)',
    context.perplexity ? `Perplexity:\n${context.perplexity}` : '(no perplexity)',
    context.tavily ? `Tavily:\n${context.tavily}` : '(no tavily)',
    '',
    'Write a concise final answer with bullets and 1–2 line summary.'
  ].join('\n')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.2 })
  })
  if (!res.ok) return ''
  const data: any = await res.json().catch(()=>null)
  const text = data?.choices?.[0]?.message?.content?.toString()?.trim() || ''
  return text
}

export type RunAgentInput = { taskId: string; instructions: string; sourceUrl?: string | null; researchQuery: string }

export async function runTaskPipeline({ taskId, instructions, sourceUrl, researchQuery }: RunAgentInput): Promise<{ final: string; parts: { urlText?: string; perplexity?: string; tavily?: string } }> {
  console.log('[agent/pipeline] start', { taskId })
  const t0 = Date.now()
  const paidFetch = getPaidFetcher()
  // Helper runner fns (not using the Agents SDK tool objects directly)
  const runFetchUrlText = async (url: string) => {
    try {
      const text = await fetchUrlTextRaw(url, paidFetch)
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url }, output: { ok: !!text, length: text?.length || 0 }, success: !!text } }).catch(()=>null)
      return { ok: !!text, text: text || '' }
    } catch (e:any) {
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
      throw e
    }
  }
  const runPerplexity = async (query: string) => {
    try {
      const out = await askPerplexityRaw(query, paidFetch)
      await prisma.toolRun.create({ data: { taskId, tool: 'PERPLEXITY', input: { query }, output: { ok: !!out }, success: !!out } }).catch(()=>null)
      return { ok: !!out, text: out || '' }
    } catch (e:any) {
      await prisma.toolRun.create({ data: { taskId, tool: 'PERPLEXITY', input: { query }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
      throw e
    }
  }
  const runTavily = async (query: string) => {
    try {
      const out = await askTavilyRaw(query, paidFetch)
      await prisma.toolRun.create({ data: { taskId, tool: 'TAVILY', input: { query }, output: { ok: !!out }, success: !!out } }).catch(()=>null)
      return { ok: !!out, text: out || '' }
    } catch (e:any) {
      await prisma.toolRun.create({ data: { taskId, tool: 'TAVILY', input: { query }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
      throw e
    }
  }
  const runX402Demo = async () => {
    try {
      const res = await paidFetch('https://triton.api.corbits.dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { status: res.status, ok: res.ok }, success: res.ok } }).catch(()=>null)
      return { ok: res.ok, status: res.status }
    } catch (e:any) {
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
      return { ok: false }
    }
  }
  const parts: { urlText?: string; perplexity?: string; tavily?: string } = {}

  if (sourceUrl) {
    const s = Date.now()
    try {
      const r: any = await runFetchUrlText(sourceUrl)
      parts.urlText = r?.text || ''
      console.log('[agent/pipeline] fetch_url_text ok', { ms: Date.now()-s, len: parts.urlText?.length || 0 })
    } catch (e:any) {
      console.error('[agent/pipeline] fetch_url_text error', { error: e?.message || String(e) })
    }
  }

  {
    const s = Date.now()
    try {
      const r: any = await runPerplexity(researchQuery)
      parts.perplexity = r?.text || ''
      console.log('[agent/pipeline] research_perplexity ok', { ms: Date.now()-s, len: parts.perplexity?.length || 0 })
    } catch (e:any) {
      console.error('[agent/pipeline] research_perplexity error', { error: e?.message || String(e) })
    }
  }

  {
    const s = Date.now()
    try {
      const r: any = await runTavily(researchQuery)
      parts.tavily = r?.text || ''
      console.log('[agent/pipeline] research_tavily ok', { ms: Date.now()-s, len: parts.tavily?.length || 0 })
    } catch (e:any) {
      console.error('[agent/pipeline] research_tavily error', { error: e?.message || String(e) })
    }
  }

  try { await runX402Demo() } catch {}

  const s2 = Date.now()
  const final = await synthesizeFinal(instructions, parts)
  console.log('[agent/pipeline] synthesize done', { ms: Date.now()-s2 })
  console.log('[agent/pipeline] end', { taskId, totalMs: Date.now()-t0 })
  return { final, parts }
}

export async function runTaskAgent({ taskId, instructions }: { taskId: string; instructions: string }): Promise<{ final: string }> {
  const { fetchUrlText, fetchUrlTextUrl, researchPerplexity, researchTavily, x402Demo } = makeTools(taskId)
  const agent = new Agent({ name: 'AgenX Researcher', instructions, model: process.env.AGENT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini', tools: [fetchUrlTextUrl, fetchUrlText, researchPerplexity, researchTavily, x402Demo] })
  const result = await run(agent, 'Proceed with the task as instructed.')
  const final = String(result.finalOutput || '').trim()
  return { final }
}

export async function runX402DemoOnce(taskId: string) {
  const paidFetch = getPaidFetcher()
  try {
    const res = await paidFetch('https://triton.api.corbits.dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
    await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { status: res.status, ok: res.ok }, success: res.ok } }).catch(()=>null)
    return { ok: res.ok }
  } catch (e:any) {
    await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
    return { ok: false }
  }
}
