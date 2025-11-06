import { NextRequest } from 'next/server'
import { verifyToken } from './auth'

export type AuthUser = {
  id: string
  email: string
  role?: string
}

export function getAuthUser(req: NextRequest): AuthUser | null {
  const auth = req.headers.get('authorization') || ''
  const [, token] = auth.split(' ')
  if (!token) return null
  return verifyToken<AuthUser>(token)
}
