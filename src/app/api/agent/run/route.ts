import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { z } from 'zod'
import { notifyDiscordForUser } from '@/server/notifier'
import { fetchUrlText, askPerplexity, askTavily } from '@/server/tools/research'
import { transferSol, usdToSol } from '@/server/payments/solana'
import { getPaidFetcher } from '@/server/payments/x402'

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

    // Mark in progress and notify
    await prisma.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } })
    if (task.createdById) await notifyDiscordForUser(task.createdById, `AgenX: Task ${taskId} in progress…`)

    // Gather base text from attachment or URL or inputText
    const paidFetch = getPaidFetcher()
    const attachmentText = task.attachment?.extractedText || null
    const urlText = task.sourceUrl ? await fetchUrlText(task.sourceUrl, paidFetch) : null
    const baseText = [task.inputText, attachmentText, urlText].filter(Boolean).join('\n\n').slice(0, 6000)

    // Extract insights from baseText if available
    let insights = ''
    if (baseText) {
      const extractPrompt = [
        buildPrompt(task),
        '',
        'Given the following content, extract 5-10 key insights as bullet points:',
        baseText,
      ].join('\n')
      insights = (await runWithOpenAI(extractPrompt)) || ''
    }

    // Research using Perplexity and Tavily
    const researchQuery = insights || task.description || task.inputText || 'Perform a short market analysis based on the topic.'
    const [px, tv] = await Promise.all([
      askPerplexity(`Research and provide concise evidence-backed bullets for: ${researchQuery}`, paidFetch),
      askTavily(`Research and provide concise bullets with top sources for: ${researchQuery}`, paidFetch),
    ])

    // Compose final result
    const finalPrompt = [
      buildPrompt(task),
      '',
      insights ? 'Insights extracted from document:' : 'No document insights available.',
      insights || '(none)',
      '',
      'External research (Perplexity):',
      px || '(none)',
      '',
      'External research (Tavily):',
      tv || '(none)',
      '',
      'Produce a final consolidated output that follows the TaskType output rules. Include a short sources section at the end if available.'
    ].join('\n')

    const aiResult = await runWithOpenAI(finalPrompt)
    const content = (aiResult ?? insights ?? px ?? tv ?? '').toString().trim()

    const succeeded = !!content
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: { resultText: succeeded ? content : null, status: succeeded ? 'COMPLETED' : 'FAILED' }
    })

    await prisma.toolRun.create({
      data: {
        taskId: taskId,
        tool: 'OPENAI',
        input: { baseText: !!baseText, usedPerplexity: !!px, usedTavily: !!tv },
        output: { content },
        success: true,
      }
    })

    if (task.createdById) {
      if (succeeded) {
        await notifyDiscordForUser(task.createdById, `AgenX: Task ${taskId} completed.`)
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
            await notifyDiscordForUser(task.createdById, `AgenX: Initiating payment of ${amountSol} SOL to agent…`)
            const sig = await transferSol(recipient, amountSol)
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
            await notifyDiscordForUser(task.createdById, `AgenX: Payment successful. Tx: ${sig}`)
          }
        } catch (e) {
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
          await notifyDiscordForUser(task.createdById, `AgenX: Payment failed.`)
        }
      } else {
        await notifyDiscordForUser(task.createdById, `AgenX: Task ${taskId} failed.`)
      }
    }

    return NextResponse.json({ task: updated })
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
