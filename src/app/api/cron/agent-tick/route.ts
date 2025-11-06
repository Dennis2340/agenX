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

  // Find a small batch of tasks that are ready to run (including freshly posted)
  const tasks = await prisma.task.findMany({
    where: { status: { in: ['POSTED', 'ASSIGNED', 'IN_PROGRESS'] } },
    orderBy: { updatedAt: 'asc' },
    take: 3,
    select: { id: true, status: true }
  })

  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

  for (const t of tasks) {
    try {
      // Pre-mark POSTED tasks as ASSIGNED to avoid duplicate dispatches
      if (t.status === 'POSTED') {
        await prisma.task.update({ where: { id: t.id }, data: { status: 'ASSIGNED' } })
      }
      await postAgentRun(baseUrl, t.id)
    } catch {}
  }

  return NextResponse.json({ queued: tasks.length })
}
