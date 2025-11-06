import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'

// Minimal x402-like webhook handler.
// Expect body: { challengeId: string, tx: string, status?: 'SUCCESS'|'FAILED', payerWallet?: string, payeeWallet?: string, settledAt?: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as any
    const { challengeId, tx, status, payerWallet, payeeWallet, settledAt } = body

    if (!challengeId || !tx) {
      return NextResponse.json({ error: 'Missing challengeId or tx' }, { status: 400 })
    }

    const payment = await prisma.payment.update({
      where: { id: challengeId },
      data: {
        txHash: tx,
        settlementSig: tx,
        status: status === 'FAILED' ? 'FAILED' : 'SUCCESS',
        payerWalletAddress: payerWallet ?? undefined,
        payeeWalletAddress: payeeWallet ?? undefined,
        settledAt: settledAt ? new Date(settledAt) : new Date(),
      }
    })

    // Optionally mark Task as PAID when payment is successful
    if (payment.status === 'SUCCESS') {
      await prisma.task.update({ where: { id: payment.taskId }, data: { status: 'PAID' } })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
