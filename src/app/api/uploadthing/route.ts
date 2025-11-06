import * as ut from 'uploadthing/next'
import { ourFileRouter } from './core'

// Some versions export createNextRouteHandler, others createRouteHandler
const handlerFactory = (ut as any).createNextRouteHandler || (ut as any).createRouteHandler
if (!handlerFactory) {
  throw new Error('UploadThing: no compatible route handler export found. Expected createNextRouteHandler or createRouteHandler.')
}

export const { GET, POST } = handlerFactory({ router: ourFileRouter })
