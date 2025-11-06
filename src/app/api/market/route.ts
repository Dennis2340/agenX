import { NextResponse } from 'next/server'
import { prisma } from '../../../server/db'

export async function GET() {
  const tasks = await prisma.task.findMany({
    where: { status: 'POSTED' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      payoutAmount: true,
      payoutCurrency: true,
      createdAt: true,
    }
  })
  return NextResponse.json({ tasks })
}
