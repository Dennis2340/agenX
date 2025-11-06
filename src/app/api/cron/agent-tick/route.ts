import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'

async function postAgentRun(baseUrl: string, taskId: string) {
  await fetch(`${baseUrl}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId })
  })
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const header = req.headers.get('x-cron-secret')
    const url = new URL(req.url)
    const qp = url.searchParams.get('key')
    if (header !== secret && qp !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find a small batch of tasks that are ready to run
  const tasks = await prisma.task.findMany({
    where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
    orderBy: { updatedAt: 'asc' },
    take: 3,
    select: { id: true }
  })

  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

  for (const t of tasks) {
    try {
      await postAgentRun(baseUrl, t.id)
    } catch {}
  }

  return NextResponse.json({ queued: tasks.length })
}
