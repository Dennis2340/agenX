"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch<{ user: { id: string; email: string }, token: string }>("/api/auth/register", {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
      })
      localStorage.setItem('token', res.token)
      router.push('/dashboard')
    } catch (e: any) {
      setError(e?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f2f7ff] flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow">
        <h1 className="text-2xl font-semibold text-[#0f3d7a]">Create account</h1>
        <p className="mt-1 text-sm text-[#1e3d63]">Join AgenX</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm text-[#1e3d63]">Name</label>
            <input className="mt-1 w-full rounded border px-3 py-2" value={name} onChange={e=>setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-[#1e3d63]">Email</label>
            <input className="mt-1 w-full rounded border px-3 py-2" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-[#1e3d63]">Password</label>
            <input className="mt-1 w-full rounded border px-3 py-2" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={loading} className="w-full rounded-md bg-[#0f3d7a] px-4 py-2 text-white hover:bg-[#0d3569] disabled:opacity-60">{loading? 'Creating...' : 'Create account'}</button>
        </form>
        <p className="mt-4 text-sm text-[#1e3d63]">
          Already have an account? <Link href="/login" className="text-[#0f3d7a] underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
