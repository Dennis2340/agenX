import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { z } from 'zod'
import { notifyDiscordForUser } from '@/server/notifier'
import { transferSol, usdToSol } from '@/server/payments/solana'
import { runTaskAgent, runX402DemoOnce } from '@/server/agent'

const schema = z.object({
  taskId: z.string(),
})

function buildPrompt(task: any) {
  const lines: string[] = []
  lines.push('You are AgenX, an autonomous AI agent that completes micro-tasks.')
  lines.push('Follow output format rules:')
  lines.push('- SUMMARIZATION: 3–5 sentence summary.')
  lines.push('- CAPTIONS: 3–5 caption options, one per line.')
  lines.push('- DATA_EXTRACTION: concise JSON with key fields.')
  lines.push('Be concise. If a URL is provided you may summarize based on its content if available.')
  lines.push('')
  lines.push(`TaskType: ${task.type}`)
  if (task.title) lines.push(`Title: ${task.title}`)
  if (task.description) lines.push(`Description: ${task.description}`)
  if (task.sourceUrl) lines.push(`SourceURL: ${task.sourceUrl}`)
  if (task.inputText) lines.push(`InputText: ${task.inputText}`)
  return lines.join('\n')
}

async function generateInstructions(task: any): Promise<string> {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY missing')
    const sys = 'You write precise system instructions for an agent that must call tools in a strict order.'
    const user = [
      'Write concise instructions for AgenX based on this task. Enforce this strict tool order:',
      '1) fetch_url_text({ url }) if sourceUrl present 2) research_perplexity 3) research_tavily 4) optional x402_demo_call 5) synthesize final answer (bullets + 1–2 lines).',
      'Adapt tone to task.type (SUMMARIZATION, DATA_EXTRACTION, CAPTIONS). Keep under 12 lines. No extra commentary.',
      '',
      buildPrompt(task),
    ].join('\n')
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AGENT_MODEL || 'gpt-4o-mini',
        messages: [ { role: 'system', content: sys }, { role: 'user', content: user } ],
        temperature: 0.2,
      })
    })
    if (!res.ok) throw new Error(`openai ${res.status}`)
    const data: any = await res.json().catch(()=>null)
    const text = data?.choices?.[0]?.message?.content?.toString()?.trim()
    if (text) return text
    throw new Error('no instructions')
  } catch (e:any) {
    console.error('[agent/run] generateInstructions fallback', { error: e?.message || String(e) })
    return buildDynamicInstructions(task)
  }
}

function shortLabel(text: string, max = 60) {
  const t = (text || '').trim()
  if (t.length <= max) return t
  return t.slice(0, max) + '…'
}

function buildDynamicInstructions(task: any) {
  const base = 'You are AgenX. Use tools in this strict order and keep answers concise.'
  const order = [
    '- If a sourceUrl exists, first call fetch_url_text({ url }) to ground on-page text.',
    '- Then call research_perplexity({ query }) for concise bullets.',
    '- Then call research_tavily({ query }) to corroborate and get links.',
    '- Optionally call x402_demo_call() once to demonstrate paid HTTP.',
    '- Finally, synthesize bullets + a 1–2 line summary.'
  ].join('\n')
  let typeNote = ''
  switch (task.type) {
    case 'DATA_EXTRACTION':
      typeNote = 'Task type: DATA_EXTRACTION. Prefer structured bullets and key fields.'
      break
    case 'CAPTIONS':
      typeNote = 'Task type: CAPTIONS. Produce short, human-friendly captions.'
      break
    default:
      typeNote = 'Task type: SUMMARIZATION. Produce concise bullets.'
  }
  return [base, typeNote, 'Policy (strict tool order):', order, '', buildPrompt(task)].join('\n')
}

async function runWithOpenAI(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.AGENT_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful AI that follows instructions exactly.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    })
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content?.toString()?.trim() || null
  return content
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { taskId } = schema.parse(body)

    const task = await prisma.task.findUnique({ where: { id: taskId }, include: { attachment: true } })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const labelFull = (task as any).title || task.description || task.inputText || `Task ${taskId}`
    const label = shortLabel(labelFull)
    console.log('[agent/run] start', { taskId, label })

    // Mark in progress and notify
    await prisma.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } })
    if (task.createdById) await notifyDiscordForUser(task.createdById, `AgenX: "${label}" in progress…`)

    // Build dynamic instructions and run autonomous agent with tool-calling
    const inst = await generateInstructions(task)
    console.log('[agent/run] autonomous begin', { taskId, hasUrl: !!task.sourceUrl })
    const { final: contentRaw } = await runTaskAgent({ taskId, instructions: inst })
    console.log('[agent/run] autonomous done', { taskId, hasOutput: !!contentRaw })
    const content = contentRaw || ''
    // Run x402 demo once after to log spend consistently
    try { await runX402DemoOnce(taskId) } catch {}

    const succeeded = !!content
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: { resultText: succeeded ? content : null, status: succeeded ? 'COMPLETED' : 'FAILED' }
    })

    try {
      await prisma.toolRun.create({
        data: {
          taskId: taskId,
          tool: 'OPENAI',
          input: { agent: 'AgentsSDK', hadOutput: !!content },
          output: { content },
          success: true,
        }
      })
    } catch (e) {
      console.error('[agent/run] toolRun OPENAI log failed', { taskId, error: (e as any)?.message || String(e) })
    }

    if (task.createdById) {
      if (succeeded) {
        await notifyDiscordForUser(task.createdById, `AgenX: "${label}" completed.`)
        // Autonomous payout: transfer a small SOL amount from treasury to agent wallet (demo)
        try {
          const recipient = process.env.AGENT_PUBLIC_KEY || ''
          let amountSol = Number(process.env.PAYOUT_SOL || '0')
          const payoutUsd = Number(process.env.PAYOUT_USD || '0')
          if (!amountSol && payoutUsd > 0) {
            const conv = await usdToSol(payoutUsd)
            amountSol = conv ? Math.max(conv, 0.000001) : 0
          }
          if (recipient && amountSol > 0) {
            await notifyDiscordForUser(task.createdById, `AgenX: Initiating payment of ${amountSol} SOL for "${label}"…`)
            console.log('[agent/run] payout begin', { taskId, amountSol, recipient })
            const sig = await transferSol(recipient, amountSol)
            console.log('[agent/run] payout success', { taskId, sig })
            // Record payment row
            await prisma.payment.create({
              data: {
                taskId: taskId,
                payerUserId: task.createdById,
                amount: amountSol.toString(),
                currency: 'SOL',
                network: process.env.SOLANA_NETWORK || 'devnet',
                status: 'SUCCESS',
                txHash: sig,
              }
            })
            const cluster = (process.env.SOLANA_NETWORK || 'devnet')
            const link = `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`
            await notifyDiscordForUser(task.createdById, `AgenX: Payment successful for "${label}". Tx: ${sig}\n${link}`)
          }
        } catch (e) {
          console.error('[agent/run] payout error', { taskId, error: (e as any)?.message || String(e) })
          await prisma.payment.create({
            data: {
              taskId: taskId,
              payerUserId: task.createdById,
              amount: (process.env.PAYOUT_SOL || process.env.PAYOUT_USD || '0'),
              currency: 'SOL',
              network: process.env.SOLANA_NETWORK || 'devnet',
              status: 'FAILED',
              txHash: null,
            }
          }).catch(()=>null)
          await notifyDiscordForUser(task.createdById, `AgenX: Payment failed for "${label}".`)
        }
      } else {
        await notifyDiscordForUser(task.createdById, `AgenX: "${label}" failed.`)
      }
    }

    return NextResponse.json({ task: updated })
  } catch (e: any) {
    console.error('[agent/run] unhandled error', { error: e?.message || String(e) })
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
