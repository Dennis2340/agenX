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

function categorizeIntent(prompt: string) {
  const p = prompt.toLowerCase()
  const wantsExtract = /(extract|summarize|insight|summary)/.test(p)
  const wantsResearch = /(research|google|web|internet|search)/.test(p)
  const wantsDocs = /(google doc|google docs|drive|document)/.test(p)

  // Map to a coarse type the rest of the system understands
  let type: 'SUMMARIZATION' | 'DATA_EXTRACTION' | 'CAPTIONS' = 'SUMMARIZATION'
  if (wantsExtract) type = 'DATA_EXTRACTION'
  if (!wantsExtract && wantsResearch) type = 'SUMMARIZATION'

  const tools = {
    webSearch: wantsResearch,
    saveToDrive: wantsDocs,
  }

  return { type, tools }
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

    const { type, tools } = categorizeIntent(prompt || '')

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

    return NextResponse.json({ task: created, inferred: { type, tools } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create task' }, { status: 400 })
  }
}
