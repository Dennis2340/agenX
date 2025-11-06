import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { z } from 'zod'

const schema = z.object({
  paymentId: z.string(),
  amount: z.string().optional(),
  mint: z.string().optional(),
  network: z.string().optional(),
  callbackUrl: z.string().url().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { paymentId, amount, mint, network, callbackUrl } = schema.parse(body)

    const payment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        amount: (amount ?? undefined) as any,
        mint: mint ?? undefined,
        network: network ?? undefined,
        callbackUrl: callbackUrl ?? undefined,
        paymentRequestUrl: `https://x402.example/challenge/${paymentId}`,
        challengeId: paymentId,
      }
    })

    return NextResponse.json({
      challenge: {
        id: payment.challengeId,
        amount: payment.amount,
        mint: payment.mint,
        network: payment.network,
        payee: payment.payeeWalletAddress,
        callbackUrl: payment.callbackUrl,
        paymentRequestUrl: payment.paymentRequestUrl,
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
