// Cron worker that delivers task alarms as Web Push notifications.
//
// Runs once a minute, picks up every `alarms` document whose `fireAt` has
// passed, pushes it to each of that user's registered devices, then re-arms
// repeating alarms for their next occurrence.

import { FirestoreClient, documentId, readFields } from './firestore'
import { getNextRepeatFireAt } from './schedule'
import { sendWebPush, type PushSubscriptionKeys, type VapidKeys } from './webpush'
import { verifyFirebaseIdToken } from './auth'
import { isVoiceRequest, resolveVoiceIntent, type VoiceRequest } from './voice'
import type { Ai } from '@cloudflare/workers-types'

export interface Env {
  FIREBASE_SERVICE_ACCOUNT: string
  FIREBASE_PROJECT_ID?: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  APP_URL?: string
  TRIGGER_SECRET?: string
  /** Workers AI, used by /voice-intent. */
  AI: Ai
}

/**
 * Origins the browser and the Android shell may call from: Capacitor serves the
 * app over `https://localhost` on Android and `capacitor://localhost` on iOS,
 * and `http://localhost:3000` is the dev server.
 */
// Keep the previous web origin working during the hosting transition.
const FIXED_ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost:3000',
  'https://my-we-btodo-app-v2.vercel.app']

/** Whether this origin may call the voice endpoint at all. */
function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = new Set(FIXED_ORIGINS)
  if (env.APP_URL) {
    try {
      allowed.add(new URL(env.APP_URL).origin)
    } catch {
      // A malformed APP_URL only costs the web origin, nothing else.
    }
  }

  if (origin === null || !allowed.has(origin)) return {}

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

/** The project the ID tokens must be signed for. */
function projectIdOf(env: Env): string {
  if (env.FIREBASE_PROJECT_ID) return env.FIREBASE_PROJECT_ID
  return (JSON.parse(env.FIREBASE_SERVICE_ACCOUNT).project_id as string) ?? ''
}

/**
 * Budget on the paid model endpoint: 30 requests a minute per user. Nobody
 * speaks 30 commands in a minute, so it only ever bites someone looping it.
 *
 * shortcut: the counter lives in this isolate's module scope, so it resets when
 * the isolate is evicted and does not span isolates. That is enough to stop a
 * single client draining the account quota; if the endpoint ever needs a real
 * quota, move it to Durable Objects or a KV counter.
 */
const VOICE_RATE_LIMIT = 30
const VOICE_RATE_WINDOW_MS = 60_000
const voiceHits = new Map<string, { count: number; resetAt: number }>()

function voiceRateLimited(uid: string, now: number): boolean {
  const hit = voiceHits.get(uid)
  if (hit === undefined || hit.resetAt <= now) {
    voiceHits.set(uid, { count: 1, resetAt: now + VOICE_RATE_WINDOW_MS })
    return false
  }
  hit.count += 1
  return hit.count > VOICE_RATE_LIMIT
}

/** A response carrying the CORS headers, if the origin is one we answer. */
function jsonWithCors(body: unknown, status: number, origin: string | null, env: Env): Response {
  return Response.json(body, { status, headers: corsHeaders(origin, env) })
}

/**
 * The rule parser in the app handles most sentences; this asks Workers AI for
 * the ones it could not read. It costs a model call per request, so it is closed
 * to callers who cannot present an ID token this project signed.
 */
async function handleVoiceIntent(request: Request, env: Env, origin: string | null) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return jsonWithCors({ error: 'unauthorized' }, 401, origin, env)
  }

  let uid: string
  try {
    ;({ uid } = await verifyFirebaseIdToken(authorization.slice('Bearer '.length), projectIdOf(env)))
  } catch (error) {
    console.warn('voice-intent auth failed', (error as Error).message)
    return jsonWithCors({ error: 'unauthorized' }, 401, origin, env)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonWithCors({ error: 'bad request' }, 400, origin, env)
  }
  if (!isVoiceRequest(body)) {
    return jsonWithCors({ error: 'bad request' }, 400, origin, env)
  }

  // Keyed on the uid the token proved, never on anything in the body. A caller
  // who cannot get past the token check cannot spend the model quota either.
  if (voiceRateLimited(uid, Date.now())) {
    return jsonWithCors({ error: 'too many requests' }, 429, origin, env)
  }

  try {
    return jsonWithCors(await resolveVoiceIntent(env.AI, body as VoiceRequest), 200, origin, env)
  } catch (error) {
    console.error('voice-intent model failed', (error as Error).message)
    return jsonWithCors({ error: 'model failed' }, 502, origin, env)
  }
}

/** Rows one query pulls, so a single response cannot overflow the worker. */
const MAX_ALARMS_PER_QUERY = 200

/**
 * Ceiling on one run. A backlog drains over consecutive runs rather than
 * sitting in the query window until it is more than an hour late and gets
 * reported as missed.
 */
const MAX_ALARMS_PER_RUN = 1000

/**
 * Alarms more than an hour late are skipped rather than delivered — a stale
 * "7:00 wake up" arriving at 14:00 is noise. They still get re-armed.
 */
const MAX_LATENESS_MS = 60 * 60 * 1000

interface AlarmRecord {
  id: string
  uid: string
  taskId: string
  title: string
  body: string
  alarm: string
  repeats: string | null
  repeatRule: unknown
  dueDate: string | null
  tz: string | null
  fireAt: number
}

interface RunSummary {
  due: number
  sent: number
  failed: number
  skippedLate: number
  prunedSubscriptions: number
  errors: string[]
}

function toAlarmRecord(name: string, fields: Record<string, unknown>): AlarmRecord | null {
  const uid = typeof fields.uid === 'string' ? fields.uid : null
  const alarm = typeof fields.alarm === 'string' ? fields.alarm : null
  const fireAt = typeof fields.fireAt === 'number' ? fields.fireAt : null
  if (!uid || !alarm || fireAt === null) return null

  const title = typeof fields.title === 'string' ? fields.title : 'Task'

  return {
    id: documentId(name),
    uid,
    taskId: typeof fields.taskId === 'string' ? fields.taskId : '',
    title,
    body: typeof fields.body === 'string' && fields.body ? fields.body : title,
    alarm,
    repeats: typeof fields.repeats === 'string' ? fields.repeats : null,
    repeatRule: fields.repeatRule ?? null,
    dueDate: typeof fields.dueDate === 'string' ? fields.dueDate : null,
    tz: typeof fields.tz === 'string' ? fields.tz : null,
    fireAt,
  }
}

function toSubscription(
  name: string,
  fields: Record<string, unknown>
): (PushSubscriptionKeys & { id: string }) | null {
  const endpoint = fields.endpoint
  const p256dh = fields.p256dh
  const auth = fields.auth
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return null
  }
  return { id: documentId(name), endpoint, p256dh, auth }
}

export async function runAlarmSweep(env: Env, now = Date.now()): Promise<RunSummary> {
  const summary: RunSummary = {
    due: 0,
    sent: 0,
    failed: 0,
    skippedLate: 0,
    prunedSubscriptions: 0,
    errors: [],
  }

  const vapid: VapidKeys = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  }

  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) {
    throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must all be set')
  }

  const firestore = new FirestoreClient(env.FIREBASE_SERVICE_ACCOUNT, env.FIREBASE_PROJECT_ID)
  const alarms: AlarmRecord[] = []

  for (;;) {
    const due = await firestore.queryDueAlarms(now, MAX_ALARMS_PER_QUERY)
    const batch = due
      .map((doc) => toAlarmRecord(doc.name, readFields(doc.fields)))
      .filter((alarm): alarm is AlarmRecord => alarm !== null)

    if (batch.length === 0) break

    await deliverBatch(batch, env, firestore, vapid, summary, now)

    // Re-armed rows move their own fireAt into the future, so the next query
    // cannot pick the same alarm up twice.
    alarms.push(...batch)
    if (alarms.length >= MAX_ALARMS_PER_RUN) break
  }

  summary.due = alarms.length
  return summary
}

/** Push one batch of due alarms and re-arm each of them. */
async function deliverBatch(
  alarms: AlarmRecord[],
  env: Env,
  firestore: FirestoreClient,
  vapid: VapidKeys,
  summary: RunSummary,
  now: number
): Promise<void> {
  // One subscription fetch per user, not per alarm.
  const subscriptionsByUid = new Map<string, Array<PushSubscriptionKeys & { id: string }>>()
  for (const uid of new Set(alarms.map((alarm) => alarm.uid))) {
    try {
      const documents = await firestore.listPushSubscriptions(uid)
      subscriptionsByUid.set(
        uid,
        documents
          .map((doc) => toSubscription(doc.name, readFields(doc.fields)))
          .filter((sub): sub is PushSubscriptionKeys & { id: string } => sub !== null)
      )
    } catch (error) {
      subscriptionsByUid.set(uid, [])
      summary.errors.push(`subscriptions ${uid}: ${(error as Error).message}`)
    }
  }

  const deadSubscriptions = new Set<string>()
  const appUrl = env.APP_URL || '/'

  /** Deep link that opens the app directly on the task that fired. */
  const taskUrl = (taskId: string): string => {
    if (!taskId) return appUrl
    try {
      const url = new URL(appUrl)
      url.searchParams.set('task', taskId)
      return url.toString()
    } catch {
      return appUrl
    }
  }

  for (const alarm of alarms) {
    const late = now - alarm.fireAt > MAX_LATENESS_MS

    if (late) {
      // A "07:00 wake up" arriving at 14:00 is noise, so it is not delivered.
      // Record it instead so the app can tell the user what they missed.
      summary.skippedLate++
      try {
        await firestore.recordMissedAlarm(alarm.uid, {
          taskId: alarm.taskId,
          title: alarm.title,
          fireAt: alarm.fireAt,
          noticedAt: now,
        })
      } catch (error) {
        summary.errors.push(`missed ${alarm.id}: ${(error as Error).message}`)
      }
    } else {
      const subscriptions = subscriptionsByUid.get(alarm.uid) ?? []

      for (const subscription of subscriptions) {
        if (deadSubscriptions.has(`${alarm.uid}/${subscription.id}`)) continue

        const result = await sendWebPush(
          subscription,
          {
            title: '🔔 ALARM',
            body: alarm.body,
            tag: alarm.taskId || alarm.id,
            taskId: alarm.taskId,
            fireAt: alarm.fireAt,
            url: taskUrl(alarm.taskId),
          },
          vapid
        )

        if (result.ok) {
          summary.sent++
          continue
        }

        summary.failed++
        summary.errors.push(`push ${alarm.id} (${result.status}): ${result.error}`)

        if (result.gone) {
          deadSubscriptions.add(`${alarm.uid}/${subscription.id}`)
          try {
            await firestore.deletePushSubscription(alarm.uid, subscription.id)
            summary.prunedSubscriptions++
          } catch {
            // Pruning is best-effort; the next run will retry.
          }
        }
      }
    }

    // Re-arm regardless of send outcome so a delivery failure cannot wedge the
    // alarm into firing on every subsequent run.
    const nextFireAt = getNextRepeatFireAt(alarm, Math.max(now, alarm.fireAt))

    try {
      if (nextFireAt !== null) {
        await firestore.updateAlarm(alarm.id, { fireAt: nextFireAt, lastSentAt: now })
      } else {
        await firestore.updateAlarm(alarm.id, { active: false, lastSentAt: now })
      }
    } catch (error) {
      summary.errors.push(`rearm ${alarm.id}: ${(error as Error).message}`)
    }
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runAlarmSweep(env)
        .then((summary) => {
          console.log('alarm sweep', JSON.stringify(summary))
        })
        .catch((error: unknown) => {
          console.error('alarm sweep failed', error)
        })
    )
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')

    if (url.pathname === '/health') {
      return Response.json({ ok: true, time: new Date().toISOString() })
    }

    if (url.pathname === '/voice-intent') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin, env) })
      }
      if (request.method !== 'POST') {
        return jsonWithCors({ error: 'bad request' }, 405, origin, env)
      }
      return handleVoiceIntent(request, env, origin)
    }

    // Manual trigger for testing. Disabled unless TRIGGER_SECRET is configured.
    if (url.pathname === '/run') {
      if (!env.TRIGGER_SECRET) {
        return new Response('Manual trigger disabled', { status: 404 })
      }
      if (request.headers.get('authorization') !== `Bearer ${env.TRIGGER_SECRET}`) {
        return new Response('Unauthorized', { status: 401 })
      }

      try {
        return Response.json(await runAlarmSweep(env))
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 500 })
      }
    }

    return new Response('task-alarm-worker', { status: 200 })
  },
}
