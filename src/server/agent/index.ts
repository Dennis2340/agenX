import { Agent, run, tool } from '@openai/agents'
import { z } from 'zod'
import { prisma } from '../db'
import { notifyDiscordForUser } from '../notifier'
import { fetchUrlText as fetchUrlTextRaw, askPerplexity as askPerplexityRaw, askTavily as askTavilyRaw } from '../tools/research'
import { getPaidFetcher, sendSol } from '../payments/x402'

export function makeTools(taskId: string, hasUrl: boolean) {
  const paidFetch = getPaidFetcher()
  let cachedUserId: string | null | undefined
  const getUserId = async (): Promise<string | null> => {
    if (typeof cachedUserId !== 'undefined') return cachedUserId
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { createdById: true } })
    cachedUserId = t?.createdById || null
    return cachedUserId
  }

  // Strict URL tool: only registered when a source URL exists on the task
  const fetchUrlText = tool({
    name: 'fetch_url_text',
    description: 'Fetch a URL and extract readable text content. Always include the { url } argument.',
    parameters: z.object({ url: z.string().url().describe('http(s) URL to fetch and extract text from') }),
    execute: async ({ url }) => {
      try {
        const uid = await getUserId()
        if (uid) await notifyDiscordForUser(uid, `AgenX: Payment attempt → DOC_PARSER (${url})`)
        const out = await fetchUrlTextRaw(url, paidFetch)
        const ok = !!out?.text
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url }, output: { ok, length: out?.text?.length || 0, amount: out?.paid?.amount, currency: out?.paid?.currency }, success: ok } }).catch(()=>null)
        if (uid) {
          if (ok && out?.paid?.amount) await notifyDiscordForUser(uid, `AgenX: Payment success → DOC_PARSER ${out.paid.amount} ${out.paid.currency || ''}`.trim())
          if (!ok) await notifyDiscordForUser(uid, `AgenX: Payment result → DOC_PARSER failed`)
        }
        return { ok, text: out?.text || '' }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        const uid = await getUserId(); if (uid) await notifyDiscordForUser(uid, `AgenX: Payment failed → DOC_PARSER (${url}) :: ${(e as any)?.message || 'error'}`)
        return { ok: false, error: e?.message || 'failed' }
      }
    }
  })

  // SOL-paid demo: send a small SOL amount to treasury, then call a public devnet RPC
  const solPaidDemo = tool({
    name: 'sol_paid_call',
    description: 'Send a tiny SOL payment to the treasury (demo), then call Solana devnet RPC.',
    parameters: z.object({}),
    execute: async () => {
      const uid = await getUserId()
      const amt = process.env.DEMO_SOL_PER_CALL || '0.0005'
      const to = process.env.AGENT_PUBLIC_KEY || process.env.NEXT_PUBLIC_PUBLIC_KEY || process.env.PUBLIC_KEY || ''
      try {
        if (!to) throw new Error('Treasury/recipient public key not configured')
        if (uid) await notifyDiscordForUser(uid, `AgenX: Payment attempt → SOL demo ${amt} SOL`)
        const { tx } = await sendSol(to, amt)
        // call a public devnet RPC after payment
        const res = await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
        const ok = res.ok
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { to, amount: amt, tag: 'sol_demo' }, output: { ok, txHash: tx, amount: amt, currency: 'SOL', status: res.status }, success: ok } }).catch(()=>null)
        if (uid) await notifyDiscordForUser(uid, `AgenX: Payment success → SOL demo ${amt} SOL (tx ${tx})`)
        return { ok, tx, status: res.status }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { to, amount: amt, tag: 'sol_demo' }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        if (uid) await notifyDiscordForUser(uid, `AgenX: Payment failed → SOL demo ${amt} SOL :: ${e?.message || 'error'}`)
        return { ok: false, error: e?.message || 'failed' }
      }
    }
  })

  const researchPerplexity = tool({
    name: 'research_perplexity',
    description: 'Query Perplexity for concise, evidence-backed bullets for a topic.',
    parameters: z.object({ query: z.string().min(2) }),
    execute: async ({ query }) => {
      try {
        const uid = await getUserId()
        if (uid) await notifyDiscordForUser(uid, `AgenX: Payment attempt → PERPLEXITY`)
        const out = await askPerplexityRaw(query, paidFetch)
        const ok = !!out?.text
        await prisma.toolRun.create({ data: { taskId, tool: 'PERPLEXITY', input: { query }, output: { ok, amount: out?.paid?.amount, currency: out?.paid?.currency }, success: ok } }).catch(()=>null)
        if (uid) {
          if (ok && out?.paid?.amount) await notifyDiscordForUser(uid, `AgenX: Payment success → PERPLEXITY ${out.paid.amount} ${out.paid.currency || ''}`.trim())
          if (!ok) await notifyDiscordForUser(uid, `AgenX: Payment result → PERPLEXITY failed`)
        }
        return { ok, text: out?.text || '' }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'PERPLEXITY', input: { query }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        const uid = await getUserId(); if (uid) await notifyDiscordForUser(uid, `AgenX: Payment failed → PERPLEXITY :: ${(e as any)?.message || 'error'}`)
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
        const uid = await getUserId()
        if (uid) await notifyDiscordForUser(uid, `AgenX: Payment attempt → TAVILY`)
        const out = await askTavilyRaw(query, paidFetch)
        const ok = !!out?.text
        await prisma.toolRun.create({ data: { taskId, tool: 'TAVILY', input: { query }, output: { ok, amount: out?.paid?.amount, currency: out?.paid?.currency }, success: ok } }).catch(()=>null)
        if (uid) {
          if (ok && out?.paid?.amount) await notifyDiscordForUser(uid, `AgenX: Payment success → TAVILY ${out.paid.amount} ${out.paid.currency || ''}`.trim())
          if (!ok) await notifyDiscordForUser(uid, `AgenX: Payment result → TAVILY failed`)
        }
        return { ok, text: out?.text || '' }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'TAVILY', input: { query }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        const uid = await getUserId(); if (uid) await notifyDiscordForUser(uid, `AgenX: Payment failed → TAVILY :: ${(e as any)?.message || 'error'}`)
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
        const uid = await getUserId()
        if (uid) await notifyDiscordForUser(uid, 'AgenX: Payment attempt → X402 demo')
        const res = await paidFetch('https://triton.api.corbits.dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { status: res.status, ok: res.ok }, success: res.ok } }).catch(()=>null)
        if (uid) await notifyDiscordForUser(uid, `AgenX: Payment ${res.ok ? 'success' : 'result'} → X402 demo (status ${res.status})`)
        return { ok: res.ok, status: res.status }
      } catch (e:any) {
        await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
        const uid = await getUserId(); if (uid) await notifyDiscordForUser(uid, `AgenX: Payment failed → X402 demo :: ${(e as any)?.message || 'error'}`)
        return { ok: false, error: (e as any)?.message || 'failed' }
      }
    }
  })

  const tools = [researchPerplexity, researchTavily, x402Demo, solPaidDemo] as any[]
  if (hasUrl) tools.unshift(fetchUrlText)
  return { tools, fetchUrlText, researchPerplexity, researchTavily, x402Demo }
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
      const out = await fetchUrlTextRaw(url, paidFetch)
      const ok = !!out?.text
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url }, output: { ok, length: out?.text?.length || 0, amount: out?.paid?.amount, currency: out?.paid?.currency }, success: ok } }).catch(()=>null)
      return { ok, text: out?.text || '' }
    } catch (e:any) {
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
      throw e
    }
  }
  const runPerplexity = async (query: string) => {
    try {
      const out = await askPerplexityRaw(query, paidFetch)
      const ok = !!out?.text
      await prisma.toolRun.create({ data: { taskId, tool: 'PERPLEXITY', input: { query }, output: { ok, amount: out?.paid?.amount, currency: out?.paid?.currency }, success: ok } }).catch(()=>null)
      return { ok, text: out?.text || '' }
    } catch (e:any) {
      await prisma.toolRun.create({ data: { taskId, tool: 'PERPLEXITY', input: { query }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
      throw e
    }
  }
  const runTavily = async (query: string) => {
    try {
      const out = await askTavilyRaw(query, paidFetch)
      const ok = !!out?.text
      await prisma.toolRun.create({ data: { taskId, tool: 'TAVILY', input: { query }, output: { ok, amount: out?.paid?.amount, currency: out?.paid?.currency }, success: ok } }).catch(()=>null)
      return { ok, text: out?.text || '' }
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
  const runSolDemoOnce = async () => {
    const uid = (await prisma.task.findUnique({ where: { id: taskId }, select: { createdById: true } }))?.createdById || null
    const amt = process.env.DEMO_SOL_PER_CALL || '0.0005'
    const to = process.env.AGENT_PUBLIC_KEY || process.env.NEXT_PUBLIC_PUBLIC_KEY || process.env.PUBLIC_KEY || ''
    try {
      if (!to) throw new Error('Treasury/recipient public key not configured')
      if (uid) await notifyDiscordForUser(uid, `AgenX: Payment attempt → SOL demo ${amt} SOL`)
      const { tx } = await sendSol(to, amt)
      const res = await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
      const ok = res.ok
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { to, amount: amt, tag: 'sol_demo' }, output: { ok, txHash: tx, amount: amt, currency: 'SOL', status: res.status }, success: ok } }).catch(()=>null)
      if (uid) await notifyDiscordForUser(uid, `AgenX: Payment success → SOL demo ${amt} SOL (tx ${tx})`)
      return { ok, tx }
    } catch (e:any) {
      await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { to, amount: amt, tag: 'sol_demo' }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
      if (uid) await notifyDiscordForUser(uid, `AgenX: Payment failed → SOL demo ${amt} SOL :: ${e?.message || 'error'}`)
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

export async function runTaskAgent({ taskId, instructions, sourceUrl }: { taskId: string; instructions: string; sourceUrl?: string | null }): Promise<{ final: string }> {
  const { tools } = makeTools(taskId, !!sourceUrl)
  const agent = new Agent({ name: 'AgenX Researcher', instructions, model: process.env.AGENT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini', tools })
  const result = await run(agent, 'Proceed with the task as instructed.')
  const final = String(result.finalOutput || '').trim()
  return { final }
}

export async function runX402DemoOnce(taskId: string) {
  const paidFetch = getPaidFetcher()
  try {
    const res = await paidFetch('https://triton.api.corbits.dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
    await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { status: res.status, ok: res.ok }, success: res.ok } }).catch(()=>null)
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { createdById: true } })
    if (t?.createdById) await notifyDiscordForUser(t.createdById, `AgenX: Payment ${res.ok ? 'success' : 'result'} → X402 demo (status ${res.status})`)
    return { ok: res.ok }
  } catch (e:any) {
    await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { url: 'https://triton.api.corbits.dev', tag: 'x402_demo' }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { createdById: true } })
    if (t?.createdById) await notifyDiscordForUser(t.createdById, `AgenX: Payment failed → X402 demo :: ${e?.message || 'error'}`)
    return { ok: false }
  }
}

export async function runSolDemoOnce(taskId: string) {
  const uid = (await prisma.task.findUnique({ where: { id: taskId }, select: { createdById: true } }))?.createdById || null
  const amt = process.env.DEMO_SOL_PER_CALL || '0.0005'
  const to = process.env.AGENT_PUBLIC_KEY || process.env.NEXT_PUBLIC_PUBLIC_KEY || process.env.PUBLIC_KEY || ''
  try {
    if (!to) throw new Error('Treasury/recipient public key not configured')
    if (uid) await notifyDiscordForUser(uid, `AgenX: Payment attempt → SOL demo ${amt} SOL`)
    const { tx } = await sendSol(to, amt)
    const res = await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }) })
    const ok = res.ok
    await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { to, amount: amt, tag: 'sol_demo' }, output: { ok, txHash: tx, amount: amt, currency: 'SOL', status: res.status }, success: ok } }).catch(()=>null)
    if (uid) await notifyDiscordForUser(uid, `AgenX: Payment success → SOL demo ${amt} SOL (tx ${tx})`)
    return { ok, tx }
  } catch (e:any) {
    await prisma.toolRun.create({ data: { taskId, tool: 'DOC_PARSER', input: { to, amount: amt, tag: 'sol_demo' }, output: { ok: false, error: e?.message || String(e) }, success: false } }).catch(()=>null)
    if (uid) await notifyDiscordForUser(uid, `AgenX: Payment failed → SOL demo ${amt} SOL :: ${e?.message || 'error'}`)
    return { ok: false }
  }
}
