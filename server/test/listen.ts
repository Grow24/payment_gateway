import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { Express } from 'express'

export async function listen(app: Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const address = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
