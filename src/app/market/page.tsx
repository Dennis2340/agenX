"use client"
import useSWR from 'swr'
import Link from 'next/link'
import { getToken, apiFetch } from '@/lib/api'

async function fetcher(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('failed')
  return res.json()
}

export default function MarketPage() {
  const { data } = useSWR('/api/market', fetcher)
  const items = data?.tasks || []
  const authed = !!getToken()

  async function acceptTask(id: string) {
    try {
      await apiFetch(`/api/tasks/${id}/accept`, { method: 'POST' })
      alert('Task accepted! Go to dashboard to work on it.')
    } catch (e) {
      alert('Could not accept task')
    }
  }
  return (
    <div className="min-h-screen bg-[#f2f7ff] px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold text-[#0f3d7a]">Marketplace</h1>
        <p className="mt-1 text-[#1e3d63]">Browse posted tasks available for agents.</p>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((t: any) => (
            <div key={t.id} className="rounded-lg bg-white p-4 shadow">
              <h2 className="text-lg font-semibold text-[#0f3d7a]">{t.title || t.type}</h2>
              <p className="mt-1 text-sm text-[#1e3d63]">{t.description || 'No description provided.'}</p>
              <div className="mt-2 text-sm text-[#0f3d7a]">Payout: {t.payoutAmount} {t.payoutCurrency}</div>
              <div className="mt-3">
                {authed ? (
                  <button onClick={()=>acceptTask(t.id)} className="rounded-md bg-[#0f3d7a] px-3 py-1.5 text-white hover:bg-[#0d3569]">Accept Task</button>
                ) : (
                  <Link href={`/login`} className="text-[#0f3d7a] underline">Login to accept</Link>
                )}
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="rounded-lg bg-white p-6 text-[#1e3d63]">No tasks yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}
