const TEXT_MAX = 6000

export async function fetchUrlText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text.slice(0, TEXT_MAX)
  } catch {
    return null
  }
}

export async function askPerplexity(prompt: string): Promise<string | null> {
  const key = process.env.PERPLEXITY_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.PERPLEXITY_MODEL || 'sonar-pro',
        messages: [
          { role: 'system', content: 'Return concise bullet points with sources if possible.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
      })
    })
    if (!res.ok) return null
    const data = await res.json().catch(()=>null)
    const content = data?.choices?.[0]?.message?.content?.toString()?.trim() || null
    return content
  } catch {
    return null
  }
}

export async function askTavily(prompt: string): Promise<string | null> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: key,
        query: prompt,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
        include_images: false,
        include_raw_content: false,
      })
    })
    if (!res.ok) return null
    const data = await res.json().catch(()=>null)
    const answer = data?.answer || ''
    const sources = Array.isArray(data?.results) ? data.results.slice(0,5).map((r:any)=>`- ${r.title} (${r.url})`).join('\n') : ''
    const out = [answer, sources].filter(Boolean).join('\n')
    return out || null
  } catch {
    return null
  }
}
