declare module 'uploadthing/next' {
  // Minimal type shims to satisfy TypeScript in this project.
  export type FileRouter = any
  export function createUploadthing(...args: any[]): any
  export function createNextRouteHandler(opts: { router: any }): { GET: any; POST: any }
}
