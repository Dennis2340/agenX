import jwt, { type Secret, type SignOptions } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const JWT_SECRET: Secret = (process.env.JWT_SECRET ?? 'dev_secret') as Secret

export function signToken<T extends object>(payload: T, expiresInSeconds: number = 60 * 60 * 24 * 7) {
  const options: SignOptions = { algorithm: 'HS256', expiresIn: expiresInSeconds }
  return jwt.sign(payload, JWT_SECRET, options)
}

export function verifyToken<T = any>(token: string): T | null {
  try {
    return jwt.verify(token, JWT_SECRET) as T
  } catch {
    return null
  }
}

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}
