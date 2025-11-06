export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

export async function apiFetch<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(url, { ...init, headers })
  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      const data = JSON.parse(text)
      message = data?.error || JSON.stringify(data)
    } catch {}
    const err = new Error(message)
    ;(err as any).status = res.status
    throw err
  }
  try {
    return JSON.parse(text) as T
  } catch {
    // Non-JSON OK responses (unlikely for our APIs)
    return text as unknown as T
  }
}
