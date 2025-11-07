import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../server/db'
import { z } from 'zod'
import { getAuthUser } from '../../../server/request'

const createSchema = z.object({
  type: z.enum(['SUMMARIZATION', 'CAPTIONS', 'DATA_EXTRACTION']).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  inputText: z.string().optional(),
  attachmentId: z.string().optional(),
  payoutAmount: z.string(),
  payoutCurrency: z.string().default('SOL'),
  saveToDrive: z.boolean().optional(),
})

async function classifyTaskType(input: { title?: string | null; description?: string | null; inputText?: string | null }): Promise<'SUMMARIZATION' | 'DATA_EXTRACTION'> {
  const text = [input.title, input.description, input.inputText].filter(Boolean).join('\n').slice(0, 2000)
  const apiKey = process.env.OPENAI_API_KEY
  if (apiKey && text) {
    try {
      const prompt = [
        'Classify the following task into one of these labels strictly: SUMMARIZATION or DATA_EXTRACTION.',
        'Return only the label. No extra words.',
        '---',
        text,
      ].join('\n')
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.AGENT_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0 })
      })
      if (res.ok) {
        const data: any = await res.json().catch(()=>null)
        const out = data?.choices?.[0]?.message?.content?.toString()?.trim().toUpperCase()
        if (out === 'DATA_EXTRACTION') return 'DATA_EXTRACTION'
        return 'SUMMARIZATION'
      }
    } catch {}
  }
  // Heuristic fallback
  const t = text.toLowerCase()
  const keywords = ['extract', 'json', 'fields', 'table', 'columns', 'key-value']
  const isExtract = keywords.some(k => t.includes(k))
  return isExtract ? 'DATA_EXTRACTION' : 'SUMMARIZATION'
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tasks = await prisma.task.findMany({
    where: { createdById: user.id },
    orderBy: { createdAt: 'desc' },
    include: { payments: true, toolRuns: true }
  })
  return NextResponse.json({ tasks })
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    const resolvedType = data.type || await classifyTaskType({ title: data.title, description: data.description, inputText: data.inputText })

    const task = await prisma.task.create({
      data: {
        type: resolvedType,
        title: data.title,
        description: data.description,
        sourceUrl: data.sourceUrl,
        inputText: data.inputText,
        attachmentId: data.attachmentId,
        payoutAmount: data.payoutAmount as any,
        payoutCurrency: data.payoutCurrency,
        createdById: user.id,
        saveToDrive: data.saveToDrive ?? false,
        payments: {
          create: {
            payerUserId: user.id,
            amount: data.payoutAmount as any,
            currency: data.payoutCurrency,
            network: 'devnet',
            mint: data.payoutCurrency,
          }
        }
      },
      include: { payments: true }
    })
    // Fire-and-forget: immediately trigger the agent to start on this task
    try {
      const headers = req.headers
      const xfProto = headers.get('x-forwarded-proto') || 'https'
      const xfHost = headers.get('x-forwarded-host')
      const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
      const pub = process.env.PUBLIC_BASE_URL || ''
      const origin = (xfHost ? `${xfProto}://${xfHost}` : '') || vercel || pub || 'http://localhost:3000'
      const url = `${origin}/api/agent/run`
      // do not await; avoid delaying response
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id }) }).catch(()=>{})
    } catch {}

    return NextResponse.json({ task })
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
