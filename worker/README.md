# Task Alarm Worker

Cloudflare Worker that delivers task alarms as Web Push notifications.

## Why this exists

A PWA cannot wake itself up. `setTimeout` in the page is killed as soon as iOS
suspends the web app, so an alarm scheduled in the browser never fires unless
the app happens to be open and on screen at that exact minute. The only
mechanism that reaches a closed iOS PWA is Web Push, and Web Push needs a
server to send the message at the right time. That server is this worker.

## How it works

1. The web app computes the next absolute fire time for every task alarm and
   writes it to the top-level `alarms` Firestore collection
   (`lib/alarm-sync.ts`).
2. The app registers each device's push endpoint under
   `users/{uid}/pushSubscriptions` (`lib/push-subscription.ts`).
3. This worker runs every minute, queries `active == true && fireAt <= now`,
   and pushes each due alarm to that user's devices.
4. Repeating alarms are re-armed to their next occurrence in the timezone the
   alarm was created in, so repeats survive even if the app is never reopened.
5. Endpoints that return 404/410 are deleted from Firestore.

Web Push encryption (RFC 8291 `aes128gcm`) and VAPID signing (RFC 8292) are
implemented directly on WebCrypto in `src/webpush.ts` — the `web-push` npm
package is Node-only and does not run on Workers.

## Setup

### 1. Create a Firebase service account

Firebase Console → Project Settings → Service accounts → *Generate new private
key*. This JSON lets the worker read and write Firestore while bypassing
security rules. Keep the downloaded file out of the repo — it is a credential.

### 2. Configure the worker

Edit `wrangler.jsonc` and set `VAPID_SUBJECT` (your `mailto:` address) and
`APP_URL` (the deployed web app URL, used as the notification click target).

### 3. Log in and upload the secrets

```bash
cd worker
npm install
npx wrangler login                                        # opens a browser
./scripts/setup-secrets.sh ~/Downloads/<project>-firebase-adminsdk-*.json
```

The script generates the VAPID key pair if needed (into the gitignored
`.vapid.json`), then uploads `FIREBASE_SERVICE_ACCOUNT`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and a random `TRIGGER_SECRET`. It prints the
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` line to copy into the web build environment (`.env.local` for local builds).

> **Do not paste the service account JSON into `wrangler secret put`.** The
> prompt reads one line, so a pretty-printed key file is truncated at the first
> newline and the worker then fails with *"FIREBASE_SERVICE_ACCOUNT is not
> valid JSON"*. Always pipe it in — that is all the script does:
>
> ```bash
> jq -c . service-account.json | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
> ```

### 4. Deploy the Firestore index and rules

The due-alarm query needs a composite index on `alarms(active, fireAt)`.

```bash
cd ..
# The CLI package is `firebase-tools` — `firebase` is the client SDK and has no binary.
npx firebase-tools login
npx firebase-tools deploy --only firestore:indexes,firestore:rules
```

### 5. Deploy

```bash
cd worker
npm run deploy
npm run tail          # live logs
```

## `POST /voice-intent`

The app parses a spoken Turkish sentence with rules (`lib/voice-intent.ts`). When
a sentence says something the rules cannot read, the app asks this endpoint to
read it with Workers AI instead. It returns the intent and nothing else — every
task write still happens in the app.

```bash
curl -X POST https://<worker>.workers.dev/voice-intent \
  -H "Authorization: Bearer <Firebase ID token>" \
  -H "content-type: application/json" \
  -d '{"text":"Yarın akşam 8 toplantı ekle","tasks":[{"id":"B","title":"kahve al"}],"today":"2026-10-09"}'
```

The body is `{ text, tasks: [{ id, title }], today }` — `text` up to 300
characters, up to 300 tasks, `today` as `YYYY-MM-DD`. The answer is the intent:

```json
{ "action": "create", "title": "toplantı", "dueDate": "2026-10-10", "alarm": "20:00" }
```

Actions are `create`, `delete`, `complete`, `update`, `list`, `confirm` and
`unknown`. A model answer that names a task id the request did not send, a date
that is not a date or a clock time that is not one is dropped rather than
passed on, so a wrong answer becomes `unknown` instead of a wrong write.

Errors are `401 {"error":"unauthorized"}` (no or invalid Firebase ID token),
`400 {"error":"bad request"}` (broken body) and `502 {"error":"model failed"}`
(the model threw or answered with something that is not JSON).

Unlike the alarm endpoints this one is closed: every call costs a model call, so
it answers only to a token this project signed. The signing keys are read from
Google's public JWKS and cached for as long as that response says they are fresh.

CORS allows the Capacitor origins (`https://localhost`, `capacitor://localhost`),
`http://localhost:3000`, the origin of `APP_URL` (now `https://xp.irfankerem.com`)
and the previous web origin `https://my-we-btodo-app-v2.vercel.app` during the
transition, so existing web installations can still call the Worker. Anything else gets no CORS
headers.

The `ai` binding in `wrangler.jsonc` is what makes this endpoint work. Adding it
requires a redeploy — `npm run deploy` after pulling, not just a secret change.
Workers AI needs a paid plan or the free AI allocation; without the binding the
endpoint answers `502`.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in
npm run dev

# fire the cron handler by hand
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

With `TRIGGER_SECRET` set you can also run a sweep against the deployed worker:

```bash
curl -H "Authorization: Bearer $TRIGGER_SECRET" https://<worker>.workers.dev/run
```

The response is the run summary: how many alarms were due, sent, failed,
skipped as too late, and how many dead subscriptions were pruned.

## Behaviour notes

- **One-minute granularity.** Cron cannot run more often, so an alarm can be up
  to ~60s late.
- **Alarms more than an hour late are skipped**, not delivered. A "07:00 wake
  up" arriving at 14:00 is noise. They are still re-armed.
- **Re-arming happens even if delivery failed**, so a bad endpoint cannot make
  the same alarm fire on every subsequent run.
- **Free tier.** 100k worker requests/day and cron triggers are included; this
  workload is far under that. Workers AI has its own free allocation, which
  `/voice-intent` spends.
- **The model never writes.** `/voice-intent` answers with an intent and stops;
  the app applies it. A bad answer can therefore only produce a wrong
  suggestion the user sees, never a wrong task.
