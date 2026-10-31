// The endpoint end to end: a real signed token, a stubbed JWKS and a fake AI.
// Nothing here reaches the network.

import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../worker/src/index'

// `worker/` is excluded from this project's tsconfig, so importing the worker
// entry point drags its runtime globals in without a type source. They are only
// signatures here; declaring them keeps `npx tsc --noEmit` clean.
declare global {
  interface ScheduledController {
    readonly scheduledTime: number
    readonly cron: string
    noRetry(): void
  }
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void
    passThroughOnException(): void
  }
}

const PROJECT = 'demo-proj'
const ISSUER = `https://securetoken.google.com/${PROJECT}`
const KID = 'endpoint-key'

/**
 * The endpoint verifies against the real clock, so its tokens are minted
 * relative to `Date.now()`. The pinned `NOW` in worker-auth.test.ts is for the
 * unit tests, which pass the clock in themselves.
 */
const NOW = Math.floor(Date.now() / 1000)

const encoder = new TextEncoder()

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

let keys: CryptoKeyPair
/** The JWKS entry: a JsonWebKey plus the `kid` and `alg` Google serves alongside it. */
interface JwkEntry extends JsonWebKey {
  kid: string
  alg: string
}

let jwk: JwkEntry
let token: string

async function signToken(claims: Record<string, unknown>): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID })))
  const payload = base64Url(encoder.encode(JSON.stringify(claims)))
  const input = `${header}.${payload}`
  const signature = await subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, encoder.encode(input))
  return `${input}.${base64Url(new Uint8Array(signature))}`
}

const subtle = webcrypto.subtle

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: PROJECT }),
    FIREBASE_PROJECT_ID: PROJECT,
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:test@example.com',
    APP_URL: 'https://app.example.com',
    AI: { run: async () => ({ response: '{"action":"unknown"}' }) },
    ...overrides,
  } as unknown as Env
}

/** Stub the JWKS the way Google serves it. */
function stubJwks(): void {
  vi.stubGlobal('fetch', async (input: unknown) => {
    if (String(input).includes('googleapis.com')) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      })
    }
    return new Response('not found', { status: 404 })
  })
}

/**
 * The JWKS cache is module scope, so each test loads a fresh worker and a fresh
 * auth module rather than inheriting the keys of the test before it.
 */
async function loadWorker() {
  vi.resetModules()
  return (await import('../worker/src/index')) as typeof import('../worker/src/index')
}

let worker: typeof import('../worker/src/index').default

async function call(
  env: Env,
  options: { method?: string; origin?: string; body?: unknown; authorization?: string | null } = {}
) {
  const method = options.method ?? 'POST'
  const origin = options.origin ?? 'https://localhost'
  const headers = new Headers({ origin })

  let body: string | undefined
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(options.body)
  }
  if (options.authorization !== null) {
    headers.set('authorization', `Bearer ${options.authorization ?? token}`)
  }

  return worker.fetch(
    new Request('https://voice.example/voice-intent', { method, headers, body }),
    env
  )
}

beforeEach(async () => {
  worker = (await loadWorker()).default
  keys = await subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  )
  jwk = { ...(await subtle.exportKey('jwk', keys.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }
  token = await signToken({ aud: PROJECT, iss: ISSUER, sub: 'user-1', iat: NOW - 60, exp: NOW + 3600 })
  stubJwks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const GOOD_BODY = {
  text: 'Yarın akşam 8 toplantı ekle',
  tasks: [
    { id: 'A', title: 'ses kaydi ekleme' },
    { id: 'B', title: 'kahve al' },
  ],
  today: '2026-10-09',
}

describe('POST /voice-intent', () => {
  // Issue case 15
  it('case 15: refuses a request without an Authorization header', async () => {
    const response = await call(makeEnv(), { body: GOOD_BODY, authorization: null })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost')
  })

  // Issue case 16
  it('case 16: refuses a broken body', async () => {
    const response = await call(makeEnv(), {
      body: { text: '', tasks: [], today: '2026-10-09' },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'bad request' })
  })

  it('case 16: refuses a body whose date is not YYYY-MM-DD', async () => {
    const response = await call(makeEnv(), { body: { ...GOOD_BODY, today: '9 Ekim 2026' } })

    expect(response.status).toBe(400)
  })

  // Issue case 17
  it('case 17: answers with the intent the model returned', async () => {
    const env = makeEnv({
      AI: { run: async () => ({ response: '{"action":"delete","taskId":"B"}' }) },
    } as unknown as Partial<Env>)

    const response = await call(env, { body: GOOD_BODY })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ action: 'delete', taskId: 'B' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost')
  })

  // Issue case 19
  it('case 19: answers 502 when the model fails', async () => {
    const env = makeEnv({
      AI: {
        run: async () => {
          throw new Error('model unavailable')
        },
      },
    } as unknown as Partial<Env>)

    const response = await call(env, { body: GOOD_BODY })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'model failed' })
  })

  it('refuses a request signed for another project', async () => {
    const other = await signToken({
      aud: 'other-proj',
      iss: 'https://securetoken.google.com/other-proj',
      sub: 'user-1',
      iat: NOW - 60,
      exp: NOW + 3600,
    })

    const response = await call(makeEnv(), { body: GOOD_BODY, authorization: other })

    expect(response.status).toBe(401)
  })
})

describe('CORS', () => {
  it.each(['https://xp.irfankerem.com', 'https://my-we-btodo-app-v2.vercel.app',
    'https://localhost', 'capacitor://localhost'])('allows %s during the hosting transition', async (origin) => {
    const response = await call(makeEnv({ APP_URL: 'https://xp.irfankerem.com' }), {
      method: 'OPTIONS', origin,
    })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  })

  // Issue case 18
  it('case 18: answers the preflight for an allowed origin', async () => {
    const response = await call(makeEnv(), { method: 'OPTIONS', origin: 'https://localhost' })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost')
    expect(response.headers.get('Vary')).toBe('Origin')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
  })

  it('case 18: sends no CORS headers to an origin that is not allowed', async () => {
    const response = await call(makeEnv(), { method: 'OPTIONS', origin: 'https://evil.example' })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('sends no CORS headers on an error response either', async () => {
    const response = await call(makeEnv(), {
      body: GOOD_BODY,
      origin: 'https://evil.example',
      authorization: null,
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})