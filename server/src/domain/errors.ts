export class BillingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'BillingError'
  }
}

export function isBillingError(error: unknown): error is BillingError {
  return error instanceof BillingError
}
