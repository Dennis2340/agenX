import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { verifyToken } from '../../../../server/auth'

function getUserFromReq(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const [, token] = auth.split(' ')
  if (!token) return null
  try {
    return verifyToken<{ id: string; email?: string; role?: string }>(token)
  } catch {
    return null
  }
}

async function classifyTaskTypeFromPrompt(prompt: string): Promise<'SUMMARIZATION' | 'DATA_EXTRACTION'> {
  const text = (prompt || '').slice(0, 2000)
  const apiKey = process.env.OPENAI_API_KEY
  if (apiKey && text) {
    try {
      const msg = [
        'Classify the following task into one of these labels strictly: SUMMARIZATION or DATA_EXTRACTION.',
        'Return only the label. No extra words.',
        '---',
        text,
      ].join('\n')
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.AGENT_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: msg }], temperature: 0 })
      })
      if (res.ok) {
        const data: any = await res.json().catch(()=>null)
        const out = data?.choices?.[0]?.message?.content?.toString()?.trim().toUpperCase()
        if (out === 'DATA_EXTRACTION') return 'DATA_EXTRACTION'
        return 'SUMMARIZATION'
      }
    } catch {}
  }
  const p = text.toLowerCase()
  const keywords = ['extract', 'json', 'fields', 'table', 'columns', 'key-value']
  return keywords.some(k => p.includes(k)) ? 'DATA_EXTRACTION' : 'SUMMARIZATION'
}

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromReq(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const prompt: string | undefined = body.prompt?.toString()
    const attachmentId: string | undefined = body.attachmentId?.toString()
    const saveToDrive: boolean = !!body.saveToDrive
    const depositTxHash: string | undefined = body.depositTxHash?.toString()
    const depositAmountSol: string | undefined = body.depositAmountSol?.toString()

    if (!prompt && !attachmentId) {
      return NextResponse.json({ error: 'Provide a prompt or an attachment' }, { status: 400 })
    }

    const type = await classifyTaskTypeFromPrompt(prompt || '')

    const created = await prisma.task.create({
      data: {
        createdById: user.id,
        type,
        title: null,
        description: prompt || null,
        inputText: prompt || null,
        sourceUrl: null,
        attachmentId: attachmentId || null,
        payoutAmount: '0.1',
        payoutCurrency: 'SOL',
        status: 'POSTED',
        saveToDrive,
        // Optionally store inferred tools in a JSON field if your schema supports it
        // metadata: { tools },
      } as any,
      select: {
        id: true,
        type: true,
        status: true,
      },
    })

    // Record the user's stake deposit as a Payment row for visibility
    if (depositTxHash && depositAmountSol) {
      await prisma.payment.create({
        data: {
          taskId: created.id,
          payerUserId: user.id,
          amount: depositAmountSol,
          currency: 'SOL',
          network: process.env.SOLANA_NETWORK || 'devnet',
          status: 'SUCCESS',
          txHash: depositTxHash,
        }
      }).catch(()=>null)
    }

    return NextResponse.json({ task: created, inferred: { type } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create task' }, { status: 400 })
  }
}
