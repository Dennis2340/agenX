import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { z } from 'zod'
import { getAuthUser } from '../../../../server/request'

const updateSchema = z.object({
  status: z.enum(['POSTED','ASSIGNED','IN_PROGRESS','COMPLETED','PAID','FAILED']).optional(),
  assignedAgentId: z.string().nullable().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  resultText: z.string().optional(),
  resultDriveFileId: z.string().optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const task = await prisma.task.findUnique({
    where: { id: (await params).id },
    include: { payments: true, toolRuns: true, assignedAgent: true, attachment: true }
  })
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ task })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id } = await params
    const task = await prisma.task.findUnique({ where: { id } })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (task.createdById !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await prisma.toolRun.deleteMany({ where: { taskId: id } }).catch(()=>null)
    await prisma.payment.deleteMany({ where: { taskId: id } }).catch(()=>null)
    await prisma.task.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e:any) {
    console.error('[tasks/delete] error', { error: e?.message || String(e) })
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = updateSchema.parse(body)

    const updated = await prisma.task.update({
      where: { id: (await params).id },
      data: {
        status: data.status,
        assignedAgentId: data.assignedAgentId ?? undefined,
        title: data.title,
        description: data.description,
        resultText: data.resultText,
        resultDriveFileId: data.resultDriveFileId,
      }
    })

    return NextResponse.json({ task: updated })
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
