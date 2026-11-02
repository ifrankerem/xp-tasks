# Deploy runbook (v2)

The v2 backend is PocketBase on devbox. It runs in Docker on `127.0.0.1:8090`, keeps its data in `/srv/xp/pb_data`, and the edge nginx publishes its API at `https://xp.irfankerem.com/api/`. The dashboard (`/_/`) and the superuser API are never public. You reach them through an SSH tunnel.

| Path | What it is |
| --- | --- |
| `deploy/pocketbase/Dockerfile` | PocketBase image. The version is pinned and the download checksum is verified. |
| `deploy/pocketbase/compose.yml` | The service: port, data volume, CORS origins. |
| `deploy/pocketbase/pb_migrations/` | Schema and settings. These files are the only place the schema changes. |
| `deploy/pocketbase/test-rules.mjs` | Checks the schema and the API rules against a throwaway PocketBase. |
| `deploy/nginx/xp.conf` | Full replacement for `/srv/edge/conf.d/xp.conf`. |

## What the schema enforces

- **`users`:** public sign-up is off (`createRule = null`). There is no OAuth2, OTP or MFA, and login is email + password. Each user can only see and edit their own record.
- **`tasks`:** every rule is `owner = @request.auth.id`, and `owner` cannot be changed.
  - Ids come from the client (8 to 32 characters, `[a-z0-9]`), so a retried create fails instead of duplicating a task.
  - Photos are a protected file field. They need a short-lived file token and are never public.
- **Settings:**
  - The rate limiter is on (login: 5 per minute per IP), and the client IP is taken from `X-Real-IP`.
  - The batch API is on.
  - A zip backup is written to `pb_data/backups` every night at 03:00, and the last 7 are kept.

## First install

All commands run on devbox.

1. Copy the service out of the git checkout, so switching branches never changes what is running:

   ```sh
   sudo mkdir -p /srv/xp/pb_data
   sudo rsync -a --delete /srv/projects/xp-tasks/deploy/pocketbase/ /srv/xp/pocketbase/
   cd /srv/xp/pocketbase
   docker compose up -d --build
   docker compose ps          # wait for "healthy"
   ```

2. Create the superuser. On first start, PocketBase prints a one-time installer link:

   ```sh
   docker compose logs pocketbase | grep -m1 pbinstall
   ```

   Open a tunnel from the laptop: `ssh -L 8090:127.0.0.1:8090 devbox`. The link starts with `http://0.0.0.0:8090`; open it with `127.0.0.1:8090` as the host instead, and set the superuser email and password. The link expires after about 30 minutes. If it has expired, `docker compose restart` prints a new one.

3. Create your account. With the tunnel still open, go to `http://127.0.0.1:8090/_/`, open **users**, choose **New record**, and enter your email and a password. Turn **verified** on. This is the account the app logs in with.

4. Publish the API through nginx:

   ```sh
   cp /srv/edge/conf.d/xp.conf /srv/edge/conf.d/xp.conf.bak
   cp /srv/projects/xp-tasks/deploy/nginx/xp.conf /srv/edge/conf.d/xp.conf
   cd /srv/edge
   docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
   ```

   The current site keeps working. This step only adds the `/api/` proxy and the blocks for `/_/` and the superuser API.

5. Check it from outside. Each command should print the code in its comment:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://xp.irfankerem.com/api/health                                   # 200
   curl -s -o /dev/null -w '%{http_code}\n' https://xp.irfankerem.com/_/                                           # 404
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://xp.irfankerem.com/api/collections/_superusers/auth-with-password  # 404
   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' \
     -d '{"email":"x@example.com","password":"aaaaaaaaaa","passwordConfirm":"aaaaaaaaaa"}' \
     https://xp.irfankerem.com/api/collections/users/records                                                         # 403
   curl -sN -m 5 https://xp.irfankerem.com/api/realtime | head -c 200; echo                                        # an "event:PB_CONNECT" line, right away
   ```

   If the realtime check prints nothing until the 5 second timeout, something is buffering the event stream. Check `proxy_buffering off` in nginx.

## Backups

- restic already covers `/srv/xp/pb_data`.
- The live SQLite files can be caught mid-write, so restore from the nightly zips in `pb_data/backups/` instead.
- To restore:
  1. Stop the service: `docker compose down`.
  2. Move the old `pb_data` aside.
  3. Unzip a backup into a fresh `/srv/xp/pb_data`.
  4. Start it again: `docker compose up -d`.

  You can also restore from the dashboard: **Settings → Backups**, over the tunnel.

## Changing the schema

Add a new file to `deploy/pocketbase/pb_migrations/`. Never edit a migration that has already been applied. Then:

```sh
node deploy/pocketbase/test-rules.mjs /path/to/pocketbase   # same version as the Dockerfile
sudo rsync -a --delete /srv/projects/xp-tasks/deploy/pocketbase/ /srv/xp/pocketbase/
cd /srv/xp/pocketbase && docker compose up -d --build       # new migrations apply on start
```

The dashboard's schema controls still work, but with `--automigrate=false` a change made there is not saved anywhere in the repo, so do not use them.

## Upgrading PocketBase

1. Change `PB_VERSION` and `PB_SHA256` in the Dockerfile. The checksum comes from that release's `checksums.txt`.
2. Change the image tag in `compose.yml`.
3. Run `test-rules.mjs` with the new binary.
4. Rebuild as above. Take a backup in the dashboard first.

## Rollback

- **API:** `cp /srv/edge/conf.d/xp.conf.bak /srv/edge/conf.d/xp.conf`, then reload nginx. The static site is not affected.
- **Service:** `cd /srv/xp/pocketbase && docker compose down`. The data stays in `/srv/xp/pb_data`.
