import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { emptyState, type BillingState } from './state.js'

export class BillingStore {
  protected state: BillingState = emptyState()
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string | null) {}

  async load(): Promise<void> {
    if (!this.filePath) return
    try {
      const raw = await readFile(this.filePath, 'utf8')
      this.state = { ...emptyState(), ...(JSON.parse(raw) as BillingState) }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }

  transaction<T>(fn: (draft: BillingState) => T | Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const draft = structuredClone(this.state)
      const result = await fn(draft)
      this.state = draft
      await this.persist()
      return result
    })
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  view(): BillingState {
    return structuredClone(this.state)
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), { mode: 0o600 })
  }
}
