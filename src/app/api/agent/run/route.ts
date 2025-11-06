import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { z } from 'zod'
import { Agent, run } from '@openai/agents'
import { webSearchTool, parseUrlTool, saveToDriveTool, notifyDiscordTool } from '../../../../server/tools/basic'

const schema = z.object({
  taskId: z.string(),
})

function buildInstructions(task: any) {
  const base = [
    'You are AgenX, an autonomous AI agent that completes micro-tasks.',
    'Output format rules:',
    '- SUMMARIZATION: 3–5 sentence summary.',
    '- CAPTIONS: return 3–5 caption options, one per line.',
    '- DATA_EXTRACTION: return concise JSON with key fields.',
    'Use tools only if helpful. Keep outputs concise.'
  ].join('\n')
  const details = `\nTaskType=${task.type}\nTitle=${task.title ?? ''}\nDescription=${task.description ?? ''}\nSourceURL=${task.sourceUrl ?? ''}`
  return base + details
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { taskId } = schema.parse(body)

    const task = await prisma.task.findUnique({ where: { id: taskId } })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const agent = new Agent({
      name: 'AgenX Agent',
      instructions: buildInstructions(task),
      model: process.env.AGENT_MODEL || 'gpt-4o-mini',
      tools: [webSearchTool, parseUrlTool, saveToDriveTool, notifyDiscordTool],
    })

    const composed = [
      task.inputText ? `User input: ${task.inputText}` : '',
      task.sourceUrl ? `Source URL: ${task.sourceUrl}` : '',
    ].filter(Boolean).join('\n') || 'Process the task as instructed.'

    const result = await run(agent, composed)
    const content = String(result.finalOutput || '').trim()

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: { resultText: content || null, status: content ? 'COMPLETED' : 'FAILED' }
    })

    await prisma.toolRun.create({
      data: {
        taskId: taskId,
        tool: 'OPENAI',
        input: { message: composed },
        output: { content },
        success: true,
      }
    })

    return NextResponse.json({ task: updated })
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
