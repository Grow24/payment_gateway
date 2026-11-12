import { existsSync } from 'node:fs'
import { join } from 'node:path'
import cors from 'cors'
import express, { type ErrorRequestHandler, type Express } from 'express'
import { isBillingError } from './domain/errors.js'
import {
  createOrder,
  devState,
  health,
  plans,
  publicLicenceKey,
  razorpayWebhook,
  verifyLicenceToken,
  verifyPayment,
  type AppDeps,
} from './http/routes.js'

export function createApp(deps: AppDeps & { frontendOrigin: string; staticRoot?: string | null }): Express {
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  const staticRoot = deps.staticRoot && existsSync(deps.staticRoot) ? deps.staticRoot : null
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use((req, res, next) => {
    cors({
      origin(origin, callback) {
        const forwardedHost = (req.get('x-forwarded-host') ?? req.get('host') ?? '').split(',')[0]?.trim()
        const requestOrigin = `${req.protocol}://${forwardedHost}`
        if (!origin || origin === deps.frontendOrigin || origin === requestOrigin) {
          callback(null, true)
          return
        }
        callback(null, false)
      },
      methods: ['GET', 'POST'],
    })(req, res, next)
  })

  app.post(
    '/api/webhooks/razorpay',
    express.raw({ type: 'application/json', limit: '100kb' }),
    asyncRoute((req, res) => razorpayWebhook(req, res, deps)),
  )

  app.use(express.json({ limit: '100kb' }))
  app.get('/api/health', (req, res) => health(req, res, deps))
  app.get('/api/plans', plans)
  app.post('/api/orders', asyncRoute((req, res) => createOrder(req, res, deps)))
  app.post('/api/payments/verify', asyncRoute((req, res) => verifyPayment(req, res, deps)))
  app.get('/api/dev/state', (req, res) => devState(req, res, deps))
  app.get('/api/licence/public-key', (req, res) => publicLicenceKey(req, res, deps))
  app.post('/api/licence/verify', (req, res) => verifyLicenceToken(req, res, deps))

  if (staticRoot) {
    app.use(express.static(staticRoot, { index: false }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()
      if (req.path.startsWith('/api')) return next()
      res.sendFile(join(staticRoot, 'index.html'), (error) => {
        if (error) next()
      })
    })
  }

  app.use((_req, res) => {
    res.status(404).json({ ok: false, code: 'not_found', message: 'Not found' })
  })

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (isBillingError(error)) {
      res.status(error.status).json({ ok: false, code: error.code, message: error.message })
      return
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ ok: false, code: 'invalid_request', message: 'Request body is not valid JSON.' })
      return
    }
    console.error(error)
    res.status(500).json({ ok: false, code: 'internal_error', message: 'Billing request failed' })
  }
  app.use(onError)
  return app
}

function asyncRoute(handler: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res).catch(next)
  }
}
