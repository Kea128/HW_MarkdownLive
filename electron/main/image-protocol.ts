import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { fromImageUrl, IMAGE_PROTOCOL } from '../../src/image-source'

export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: IMAGE_PROTOCOL, privileges: { standard: true, secure: true } }])
}

export function serveLocalImages(isAllowed: (filePath: string) => boolean): void {
  protocol.handle(IMAGE_PROTOCOL, async (request) => {
    const filePath = fromImageUrl(request.url)
    if (!filePath || !isAllowed(filePath)) return new Response(null, { status: 404 })
    try {
      const file = await net.fetch(pathToFileURL(filePath).href)
      return new Response(file.body, {
        status: file.status,
        headers: {
          'content-type': file.headers.get('content-type') ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
