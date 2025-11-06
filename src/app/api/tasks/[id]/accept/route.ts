import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../server/db'
import { getAuthUser } from '../../../../../server/request'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const taskId = (await params).id
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (task.status !== 'POSTED') return NextResponse.json({ error: 'Task not available' }, { status: 400 })

  // Ensure agent exists for this user
  let agent = await prisma.agent.findUnique({ where: { userId: user.id } }).catch(() => null)
  if (!agent) {
    agent = await prisma.agent.create({ data: { userId: user.id, status: 'ACTIVE' } })
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { assignedAgentId: agent.id, status: 'ASSIGNED' },
    include: { assignedAgent: true }
  })

  return NextResponse.json({ task: updated })
}
