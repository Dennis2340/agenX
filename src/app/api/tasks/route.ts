import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../server/db'
import { z } from 'zod'
import { getAuthUser } from '../../../server/request'

const createSchema = z.object({
  type: z.enum(['SUMMARIZATION', 'CAPTIONS', 'DATA_EXTRACTION']),
  title: z.string().optional(),
  description: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  inputText: z.string().optional(),
  attachmentId: z.string().optional(),
  payoutAmount: z.string(),
  payoutCurrency: z.string().default('SOL'),
  saveToDrive: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tasks = await prisma.task.findMany({
    where: { createdById: user.id },
    orderBy: { createdAt: 'desc' },
    include: { payments: true }
  })
  return NextResponse.json({ tasks })
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    const task = await prisma.task.create({
      data: {
        type: data.type,
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

    return NextResponse.json({ task })
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
