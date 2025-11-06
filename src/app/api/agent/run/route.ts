import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { z } from 'zod'
import { notifyDiscordForUser } from '@/server/notifier'

const schema = z.object({
  taskId: z.string(),
})

function buildPrompt(task: any) {
  const lines: string[] = []
  lines.push('You are AgenX, an autonomous AI agent that completes micro-tasks.')
  lines.push('Follow output format rules:')
  lines.push('- SUMMARIZATION: 3–5 sentence summary.')
  lines.push('- CAPTIONS: 3–5 caption options, one per line.')
  lines.push('- DATA_EXTRACTION: concise JSON with key fields.')
  lines.push('Be concise. If a URL is provided you may summarize based on its content if available.')
  lines.push('')
  lines.push(`TaskType: ${task.type}`)
  if (task.title) lines.push(`Title: ${task.title}`)
  if (task.description) lines.push(`Description: ${task.description}`)
  if (task.sourceUrl) lines.push(`SourceURL: ${task.sourceUrl}`)
  if (task.inputText) lines.push(`InputText: ${task.inputText}`)
  return lines.join('\n')
}

async function runWithOpenAI(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.AGENT_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful AI that follows instructions exactly.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    })
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content?.toString()?.trim() || null
  return content
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { taskId } = schema.parse(body)

    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Mark in progress and notify
    await prisma.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } })
    if (task.createdById) await notifyDiscordForUser(task.createdById, `AgenX: Task ${taskId} in progress…`)

    const prompt = buildPrompt(task)
    const aiResult = await runWithOpenAI(prompt)
    const content = (aiResult ?? '').toString().trim()

    const succeeded = !!content
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: { resultText: succeeded ? content : null, status: succeeded ? 'COMPLETED' : 'FAILED' }
    })

    await prisma.toolRun.create({
      data: {
        taskId: taskId,
        tool: 'OPENAI',
        input: { prompt },
        output: { content },
        success: true,
      }
    })

    if (task.createdById) {
      if (succeeded) {
        await notifyDiscordForUser(task.createdById, `AgenX: Task ${taskId} completed.`)
      } else {
        await notifyDiscordForUser(task.createdById, `AgenX: Task ${taskId} failed.`)
      }
    }

    return NextResponse.json({ task: updated })
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
