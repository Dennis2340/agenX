import { createUploadthing, type FileRouter } from 'uploadthing/next'
import { prisma } from '../../../server/db'
import { verifyToken } from '../../../server/auth'

const f = createUploadthing()

export const ourFileRouter = {
  taskAttachment: f({
    pdf: { maxFileSize: '16MB' },
    csv: { maxFileSize: '8MB' },
    text: { maxFileSize: '4MB' },
    'application/msword': { maxFileSize: '16MB' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { maxFileSize: '16MB' },
  })
    .middleware(async ({ req }: any) => {
      const auth = req?.headers?.get?.('authorization') || ''
      const [, token] = String(auth).split(' ')
      const user = token ? verifyToken<{ id: string }>(token) : null
      return { userId: user?.id || null }
    })
    .onUploadComplete(async (args: any) => {
      const file = args?.file
      const userId = args?.metadata?.userId || 'public'
      // Store a Document row pointing to the UploadThing file URL
      const doc = await prisma.document.create({
        data: {
          userId,
          type: file?.type?.includes('pdf') ? 'PDF' : file?.type?.includes('csv') ? 'CSV' : 'TEXT',
          storage: 'WEB',
          url: file?.url ?? null,
        } as any,
      })
      return { uploaded: true, url: file?.url, documentId: doc.id }
    }),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter
