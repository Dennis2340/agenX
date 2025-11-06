"use client"
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch, getToken } from '@/lib/api'
import { UploadButton } from "@uploadthing/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Menu, LogOut, UploadCloud } from "lucide-react"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"

const TaskTypes = ['SUMMARIZATION', 'CAPTIONS', 'DATA_EXTRACTION'] as const

type Task = {
  id: string
  type: (typeof TaskTypes)[number]
  title?: string | null
  description?: string | null
  sourceUrl?: string | null
  inputText?: string | null
  payoutAmount: string
  payoutCurrency: string
  status: 'POSTED'|'ASSIGNED'|'IN_PROGRESS'|'COMPLETED'|'PAID'|'FAILED'
  resultText?: string | null
  createdAt: string
  payments?: { id: string; status: string }[]
}

const fetcher = (url: string) => apiFetch(url)

export default function DashboardPage() {
  const authed = useMemo(() => !!getToken(), [])
  const { data, mutate } = useSWR(authed ? '/api/tasks' : null, fetcher)
  const tasks: Task[] = data?.tasks || []

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [form, setForm] = useState({
    type: 'SUMMARIZATION' as (typeof TaskTypes)[number],
    title: '',
    description: '',
    sourceUrl: '',
    inputText: '',
    payoutAmount: '0.1',
    payoutCurrency: 'SOL',
    saveToDrive: false,
    attachmentId: '' as string | undefined,
  })
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<Record<string, any>>({})
  const [formError, setFormError] = useState<string>("")
  const [formSuccess, setFormSuccess] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [typeFilter, setTypeFilter] = useState<string>("ALL")
  const [quickOpen, setQuickOpen] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [discordInvite, setDiscordInvite] = useState<string>("")
  const [discordConnected, setDiscordConnected] = useState<boolean>(false)
  const [discordTesting, setDiscordTesting] = useState<boolean>(false)
  const [discordChannelId, setDiscordChannelId] = useState<string>("")
  const [savingDiscord, setSavingDiscord] = useState<boolean>(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [viewTaskId, setViewTaskId] = useState<string | null>(null)
  const [queueRunning, setQueueRunning] = useState(false)

  function linkify(text: string) {
    const urlRegex = /(https?:\/\/[^\s)]+)|(www\.[^\s)]+)/g
    return text.replace(urlRegex, (match) => {
      const url = match.startsWith('http') ? match : `https://${match}`
      return `<a href="${url}" target="_blank" rel="noreferrer" class="underline text-[#0f3d7a]">${match}</a>`
    })
  }

  async function runQueue() {
    setQueueRunning(true)
    try {
      const url = '/api/cron/agent-tick'
      await fetch(url)
    } finally {
      setQueueRunning(false)
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    setFormError("")
    setFormSuccess("")
    // Quick prompt validation
    if (!prompt.trim() && !form.attachmentId) {
      setFormError("Type a task prompt or attach a file")
      return
    }
    if (!discordConnected || !discordChannelId) {
      setFormError("Connect Discord and set a Channel ID (then Send Test Message) before creating tasks")
      return
    }
    setCreating(true)
    try {
      await apiFetch('/api/tasks/quick', {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt.trim() || undefined,
          attachmentId: form.attachmentId || undefined,
          saveToDrive: form.saveToDrive || false,
        })
      })
      setForm({ ...form, title: '', description: '', sourceUrl: '', inputText: '', attachmentId: undefined })
      setPrompt("")
      mutate()
      setFormSuccess("Task created successfully")
      setQuickOpen(false)
      // Fire-and-forget Discord notification
      fetch('/api/integrations/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'AgenX: Task received.', channelId: discordChannelId }) })
    } catch (e) {
      setFormError((e as any)?.message || 'Failed to create task')
    } finally {
      setCreating(false)
    }
  }

  async function generateChallenge(task: Task) {
    try {
      const pid = task.payments?.[0]?.id
      if (!pid) return
      const res = await apiFetch<{ challenge: any }>("/api/payments/challenge", {
        method: 'POST',
        body: JSON.stringify({ paymentId: pid })
      })
      setChallenge((s) => ({ ...s, [task.id]: res.challenge }))
    } catch (e) {
      // noop
    }
  }

  async function runAgent(taskId: string) {
    setRunning(taskId)
    try {
      await apiFetch('/api/agent/run', { method: 'POST', body: JSON.stringify({ taskId }) })
      mutate()
    } catch (e) {
      // noop
    } finally {
      setRunning(null)
    }
  }

  function logout() {
    localStorage.removeItem('token')
    window.location.href = '/login'
  }

  useEffect(() => {
    if (!authed) window.location.href = '/login'
    // Load Discord invite URL
    ;(async () => {
      try {
        const res = await fetch('/api/integrations/discord')
        const data = await res.json()
        if (data?.inviteUrl) setDiscordInvite(data.inviteUrl)
      } catch {}
    })()
    // Restore connection status from localStorage
    const saved = localStorage.getItem('discordConnected')
    if (saved === 'true') setDiscordConnected(true)
    const savedChannel = localStorage.getItem('discordChannelId')
    if (savedChannel) setDiscordChannelId(savedChannel)
  }, [authed])

  async function testDiscord() {
    setDiscordTesting(true)
    try {
      const res = await fetch('/api/integrations/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'AgenX: Discord connection test ✅', channelId: discordChannelId || undefined }) })
      if (!res.ok) throw new Error('Discord test failed')
      setDiscordConnected(true)
      localStorage.setItem('discordConnected', 'true')
      if (discordChannelId) localStorage.setItem('discordChannelId', discordChannelId)
    } catch (e) {
      setDiscordConnected(false)
      localStorage.removeItem('discordConnected')
      // keep channel id for correction, do not remove
    } finally {
      setDiscordTesting(false)
    }
  }

  async function saveDiscordChannel() {
    setSavingDiscord(true)
    try {
      await fetch('/api/settings/discord', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }, body: JSON.stringify({ channelId: discordChannelId }) })
    } finally {
      setSavingDiscord(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className={`hidden md:flex flex-col border-r bg-card transition-all duration-200 ${sidebarOpen ? 'w-60' : 'w-16'}`}>
        <div className="h-14 flex items-center px-3">
          <div className="font-semibold text-[#0f3d7a] truncate">{sidebarOpen ? 'AgenX' : 'A'}</div>
        </div>
        <nav className="px-2 pb-4 space-y-1">
          <Button variant="ghost" className="w-full justify-start">Dashboard</Button>
          <Button variant="ghost" className="w-full justify-start">Marketplace</Button>
          <Button variant="ghost" className="w-full justify-start">Payments</Button>
          <Button variant="ghost" className="w-full justify-start">Settings</Button>
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        <header className="border-b bg-background">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button className="hidden md:inline-flex" variant="ghost" size="icon" onClick={()=>setSidebarOpen(v=>!v)}>
                <Menu className="h-5 w-5" />
              </Button>
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button className="md:hidden" variant="ghost" size="icon">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-64">
                  <div className="h-14 flex items-center px-4 font-semibold text-[#0f3d7a]">AgenX</div>
                  <nav className="px-2 pb-4 space-y-1">
                    <Button variant="ghost" className="w-full justify-start" onClick={()=>setMobileOpen(false)}>Dashboard</Button>
                    <Button variant="ghost" className="w-full justify-start" onClick={()=>setMobileOpen(false)}>Marketplace</Button>
                    <Button variant="ghost" className="w-full justify-start" onClick={()=>setMobileOpen(false)}>Payments</Button>
                    <Button variant="ghost" className="w-full justify-start" onClick={()=>setMobileOpen(false)}>Settings</Button>
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
            <div className="font-semibold text-[#0f3d7a]">AgenX Dashboard</div>
            <div className="flex items-center gap-3">
              {/* Discord Settings Modal Trigger */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant={discordConnected? 'secondary' : 'outline'} size="sm">{discordConnected ? 'Discord Connected' : 'Discord'}</Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
                  <Card>
                    <CardHeader>
                      <CardTitle>Discord Setup</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm">Invite Bot</label>
                        {discordInvite ? (
                          <a href={discordInvite} target="_blank" rel="noreferrer" className="text-sm underline text-[#0f3d7a]">Open Invite Link</a>
                        ) : (
                          <div className="text-xs text-muted-foreground">Invite URL unavailable. Ensure DISCORD_APP_ID is set.</div>
                        )}
                        <p className="text-xs text-muted-foreground">Invite the bot to your server. Then paste a Channel ID below.</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm">Channel ID</label>
                        <Input placeholder="e.g. 1021610500330631261" value={discordChannelId} onChange={(e)=>setDiscordChannelId(e.target.value)} className="text-foreground" />
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={saveDiscordChannel} disabled={!discordChannelId || savingDiscord}>{savingDiscord ? 'Saving…' : 'Save'}</Button>
                          <Button size="sm" onClick={testDiscord} disabled={!discordChannelId || discordTesting}>{discordTesting ? 'Testing…' : 'Send Test Message'}</Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Enable Developer Mode in Discord → right‑click channel → Copy ID.</p>
                      </div>
                    </CardContent>
                  </Card>
                </SheetContent>
              </Sheet>

              <Button variant="outline" size="sm" onClick={runQueue} disabled={queueRunning}>{queueRunning ? 'Queue…' : 'Run Queue'}</Button>
              <Sheet open={quickOpen} onOpenChange={setQuickOpen}>
                <SheetTrigger asChild>
                  <Button disabled={!discordConnected || !discordChannelId} title={!discordConnected ? 'Connect Discord first' : (!discordChannelId ? 'Enter Channel ID' : undefined)}>New Task</Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:w-[540px] overflow-y-auto">
                  <Card>
                    <CardHeader>
                      <CardTitle>Quick Task</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {formError && (
                        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive px-3 py-2 text-sm">
                          {formError}
                        </div>
                      )}
                      {formSuccess && (
                        <div className="mb-3 rounded-md border border-green-400/30 bg-green-100 text-green-800 px-3 py-2 text-sm">
                          {formSuccess}
                        </div>
                      )}
                      <form onSubmit={createTask} className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-sm">What should the agent do?</label>
                          <Textarea className="text-foreground" rows={6} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="e.g. Extract insights from the attached document, research those insights online, save the report to my Google Docs, and notify me when done." />
                          <p className="text-xs text-muted-foreground">Describe your task in natural language. The agent will infer the best tools to use.</p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm">Attachment</label>
                          <div className="flex items-center gap-2">
                            <UploadButton
                              endpoint="taskAttachment"
                              onClientUploadComplete={(res: any) => {
                                const id = res?.[0]?.serverData?.documentId as string | undefined
                                setForm((s)=> ({ ...s, attachmentId: id }))
                              }}
                              onUploadError={() => {}}
                            />
                            <UploadCloud className="h-4 w-4 text-muted-foreground" />
                          </div>
                          {form.attachmentId && (
                            <div className="text-xs text-[#0f3d7a]">Attached: {form.attachmentId}</div>
                          )}
                          <p className="text-xs text-muted-foreground">Upload PDF/CSV/TXT or DOC/DOCX.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input id="saveToDrive" type="checkbox" checked={form.saveToDrive} onChange={e=>setForm(s=>({ ...s, saveToDrive: e.target.checked }))} />
                          <label htmlFor="saveToDrive" className="text-sm">Save result</label>
                        </div>
                        <Button type="submit" disabled={creating} className="w-full">{creating ? 'Creating...' : 'Create Task'}</Button>
                      </form>
                    </CardContent>
                  </Card>
                </SheetContent>
              </Sheet>
              <Button variant="outline" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" /> Logout
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl grid grid-cols-1 gap-6 p-4 w-full">
          {/* My Tasks */}
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>My Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <label className="text-sm">Status</label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      {['ALL','POSTED','ASSIGNED','IN_PROGRESS','COMPLETED','PAID','FAILED'].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm">Type</label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      {['ALL', ...TaskTypes].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ScrollArea className="h-[600px] pr-3">
                <div className="space-y-3">
                  {tasks
                    .filter(t => statusFilter==='ALL' || t.status===statusFilter)
                    .filter(t => typeFilter==='ALL' || t.type===typeFilter)
                    .map(t => (
                      <Card key={t.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-[#0f3d7a]">{t.title || t.type}</div>
                              <div className="text-sm text-muted-foreground">{t.description}</div>
                              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>Payout: {t.payoutAmount} {t.payoutCurrency}</span>
                                <Badge variant="secondary">{t.status}</Badge>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" onClick={()=>runAgent(t.id)} disabled={running===t.id}>{running===t.id? 'Running...' : 'Run Agent'}</Button>
                              <Button onClick={()=>generateChallenge(t)} disabled={!t.payments || t.payments.length===0}>Generate Challenge</Button>
                              {challenge[t.id]?.paymentRequestUrl && (
                                <Button asChild>
                                  <a href={challenge[t.id].paymentRequestUrl} target="_blank" rel="noreferrer">Pay Now</a>
                                </Button>
                              )}
                              {t.resultText && (
                                <Button variant="secondary" onClick={()=>{ setViewTaskId(t.id); setViewOpen(true) }}>View Result</Button>
                              )}
                            </div>
                          </div>
                          {t.resultText && (
                            <pre className="mt-3 whitespace-pre-wrap rounded bg-[#f7fbff] p-3 text-sm text-[#0f3d7a]">{t.resultText}</pre>
                          )}
                          {challenge[t.id] && (
                            <pre className="mt-3 whitespace-pre-wrap rounded bg-[#fff7f2] p-3 text-xs text-[#7a3d0f]">{JSON.stringify(challenge[t.id], null, 2)}</pre>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  {tasks.length === 0 && (
                    <Card>
                      <CardContent className="p-6 text-sm text-muted-foreground">No tasks yet. Create your first task.</CardContent>
                    </Card>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </main>
      </div>
      <Sheet open={viewOpen} onOpenChange={setViewOpen}>
        <SheetContent side="right" className="w-full sm:w-[700px] overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle>Result</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const task = tasks.find(x => x.id === viewTaskId)
                const html = task?.resultText ? linkify(task.resultText) : ''
                return (
                  <div className="prose max-w-none whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: html }} />
                )
              })()}
            </CardContent>
          </Card>
        </SheetContent>
      </Sheet>
    </div>
  )
}
