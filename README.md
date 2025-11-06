This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

# AgenX

Autonomous micro-task agent with research tools and Discord notifications. Create a task in natural language, the agent extracts insights, performs web research (Perplexity + Tavily), and saves results in-app. Discord notifies you at each stage.

## Features

- Task creation via a single prompt (Quick Task modal)
- File upload support (attachment used when available)
- Agent runner updates statuses: POSTED → ASSIGNED → IN_PROGRESS → COMPLETED/FAILED
- Research tools: Perplexity (sonar-pro), Tavily, basic URL text extractor
- Discord onboarding and notifications (received, in progress, completed/failed)
- Result viewer modal with linkified URLs
- Cron endpoint to process tasks in the background

## Tech Stack

- Next.js App Router, TypeScript
- Prisma + PostgreSQL
- shadcn/ui + TailwindCSS
- SWR on the client

## Quick Start (Local)

1) Install deps

```bash
npm install
```

2) Configure environment in `.env`

Required

- DATABASE_URL=postgres://...
- JWT_SECRET=change_me
- OPENAI_API_KEY=...
- DISCORD_APP_ID=...
- DISCORD_BOT_TOKEN=...

Optional (recommended)

- DISCORD_CHANNEL_ID=... (fallback post channel)
- PERPLEXITY_API_KEY=...
- PERPLEXITY_MODEL=sonar-pro
- TAVILY_API_KEY=...
- CRON_SECRET=some-secret
- PUBLIC_BASE_URL=http://localhost:3000

3) Prisma

```bash
npx prisma generate
npx prisma migrate dev --name init
```

4) Run dev server

```bash
npm run dev
```

Open http://localhost:3000

## Discord Onboarding (Local)

- Header → Discord button → modal opens
- Invite Bot: uses GET `/api/integrations/discord` to show an invite URL built from `DISCORD_APP_ID`
- Paste Channel ID (Discord → Developer Mode → right-click channel → Copy ID)
- Save → Send Test Message
- Once “Discord Connected”, the New Task button unlocks

## Creating a Task

- Click New Task (top-right)
- Describe your task in natural language (e.g., “Extract insights from this text, research comparable products, include sources, end with an action plan”).
- Optionally attach a file. Optionally toggle “Save result”.
- Submit. You’ll see “Task received” in Discord.

## Running Tasks

Two options:

- Manual: Click “Run Agent” on a task card
- Background: Hit cron endpoint to process queued tasks

Cron endpoint (works without the browser open):

- GET `/api/cron/agent-tick` (optionally `?key=CRON_SECRET`)
- Picks tasks with status POSTED/ASSIGNED/IN_PROGRESS
- Marks POSTED as ASSIGNED and calls `/api/agent/run`

Windows Task Scheduler example action:

```powershell
powershell -Command "Invoke-WebRequest -Method GET 'http://localhost:3000/api/cron/agent-tick' | Out-Null"
```

Vercel Cron example:

- Path: `/api/cron/agent-tick`
- Schedule: every 1–5 minutes
- Header or query with CRON_SECRET

## Agent Runner Details

Route: `POST /api/agent/run` with `{ taskId }`

- Sets status to IN_PROGRESS and notifies Discord
- Collects base text from:
  - Task.inputText
  - Task.attachment.extractedText (if available)
  - Task.sourceUrl (fetched and stripped text)
- Extracts insights from base text (OpenAI Chat Completions)
- Performs research with Perplexity + Tavily
- Composes final consolidated result and saves `Task.resultText`
- Sets status COMPLETED/FAILED and notifies Discord

## Data Model (high level)

- Task: status, type, inputText/sourceUrl/attachmentId, resultText, createdById
- Document: extractedText, url or driveFileId
- UserSetting: discordChannelId per user
- Notification, ToolRun for audit

## API Endpoints (key)

- `POST /api/tasks/quick` → create a task from prompt
- `GET|POST /api/integrations/discord` → invite URL + send message
- `GET|POST /api/settings/discord` → load/save per-user Channel ID
- `GET /api/cron/agent-tick` → scheduler entry
- `POST /api/agent/run` → run a specific task

## UI

- Dashboard with sidebar + filters
- Quick Task modal (prompt + optional attachment)
- Result viewer: View Result → right sheet with scroll

## Troubleshooting

- Discord no messages
  - Ensure `DISCORD_BOT_TOKEN` and channel ID are correct
  - Use the Discord modal → Send Test Message
  - Bot must have permissions: View Channels, Send Messages
- Cron not running
  - Call `/api/cron/agent-tick` manually
  - Configure Windows Task Scheduler or Vercel Cron
- Empty results
  - Ensure `OPENAI_API_KEY` set
  - Provide clear prompt and base text or a URL
  - Add `PERPLEXITY_API_KEY` and `TAVILY_API_KEY` for richer research

## Security Notes

- Never commit real secrets to git
- Rotate Discord bot token if exposed
- Use `CRON_SECRET` for protected cron calls

