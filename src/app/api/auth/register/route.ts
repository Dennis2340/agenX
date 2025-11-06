import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../server/db'
import { hashPassword, signToken } from '../../../../server/auth'
import { z, ZodError } from 'zod'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) {
      console.error('[register] Invalid JSON body')
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const parsed = schema.parse(body)
    const email = parsed.email.trim().toLowerCase()
    const password = parsed.password
    const name = parsed.name
    console.log('[register] Attempt', { email })

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
    }

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
      select: { id: true, email: true, role: true }
    })

    const token = signToken({ id: user.id, email: user.email, role: user.role })
    return NextResponse.json({ user, token })
  } catch (e: any) {
    if (e instanceof ZodError) {
      console.error('[register] Zod validation failed', e.issues)
      return NextResponse.json({ error: 'Validation failed', issues: e.flatten() }, { status: 400 })
    }
    // Prisma unique constraint
    if (typeof e?.code === 'string' && e.code === 'P2002') {
      console.error('[register] Duplicate email')
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
    }
    // Prisma: table/column missing (likely migrations not run)
    if (typeof e?.code === 'string' && (e.code === 'P2021' || e.code === 'P2019')) {
      console.error('[register] Migration missing', e)
      return NextResponse.json({ error: 'Database not migrated. Run: npx prisma generate && npx prisma migrate dev' }, { status: 500 })
    }
    if (typeof e?.name === 'string' && e.name.includes('PrismaClientInitializationError')) {
      console.error('[register] DB init error', e)
      return NextResponse.json({ error: 'Database connection failed. Check DATABASE_URL' }, { status: 500 })
    }
    console.error('[register] Unexpected error', e)
    return NextResponse.json({ error: e?.message || 'Invalid request' }, { status: 400 })
  }
}
