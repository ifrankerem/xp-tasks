# Handoff: xp-tasks v2 rewrite

For whoever continues this work in a new session. Read [PLAN.md](PLAN.md) and [BUGS.md](BUGS.md) first.

## State (2026-11-02)

| Phase | State |
| --- | --- |
| 1. PocketBase schema + runbook | Merged (#31) and live on devbox: `https://xp.irfankerem.com/api/` |
| 2. Data layer + sync + tests | PR #32 into `v2`, waiting for review |
| 3. Görevler + form | Next |
| 4–8 | Not started |

## How the work is done

- **Branches and PRs:** one PR per phase, from a branch off `v2` into `v2` (e.g. `v2-phase3-tasks`). Old code (root Next.js app, `worker/`, Firebase files) stays until the cutover PR.
- **Commits:**
  - Author: `ifrankerem <121255615+ifrankerem@users.noreply.github.com>`.
  - Format: Conventional Commits.
  - No AI attribution anywhere: no Co-Authored-By, no "Generated with" lines.
- **TDD** for logic. Before claiming that a test guards a rule, break the rule on purpose and check that the test fails.
- **The v2 app is in `web/`:** run `npm ci`, `npm test`, `npx tsc --noEmit`.
  - The PocketBase integration test runs only with `PB_BIN` set. To get the binary:
    ```sh
    curl -sSLO https://github.com/pocketbase/pocketbase/releases/download/v0.40.6/pocketbase_0.40.6_linux_amd64.zip
    unzip pocketbase_0.40.6_linux_amd64.zip pocketbase
    PB_BIN=$PWD/pocketbase npm test
    ```
  - The checksum is in `deploy/pocketbase/Dockerfile`.
- **Old app checks must stay green:** at the repo root, run `npm test`, `npx tsc --noEmit` and `npm run lint`.
- **UI:** Turkish text, OLED black, React + TypeScript + Vite + Tailwind.
  - Colors: `#000` background; cards `#0d0d0d` with `#1c1c1c` borders; white text, gray secondary text.
  - Accents: green `#1f8f4e` for done, orange `#ff9f43` for alarms, red `#ff6b6b` for destructive actions and overdue.
  - Font: Inter. Large touch targets.

## What needs the devbox, not a cloud session

- **Design inputs:** the brief (`~/inbox/xp-rewrite-master-prompt.md`) and the mockups (`~/inbox/xp-mockups/`: `home.html` option A, `calendar.html`, `calendar-v2.html`, `alarm.html`). They are not in the repo. The brief is summarized in PLAN.md, but phases 3–5 need the mockups.
- **Phase 6, the native alarm module:** needs the Android SDK at `~/Android/Sdk`, a Gradle heap of about 3 GB, and no emulator. Device tests run on the owner's phone over Tailscale wireless debugging; ask for the pairing code.
- **Deploys:** `npm run deploy` writes to `/srv/sites/xp`. Anything in `/srv/edge` or `/srv/xp` is applied by the owner, following `deploy/README.md`. There is no Docker or sudo access.
- **Debug APKs** go to `~/inbox/out/`.

## Next: phase 3 (Görevler + form)

1. Set up Vite + React + Tailwind in `web/`. Use a hash router (`#/`, `#/gorev/:id`, `#/takvim`, `#/arsiv`, `#/ayarlar`). Add a login screen with PocketBase email + password.
2. Görevler (`home.html` option A):
   - A search box at the top, matching title and note.
   - A list/grid toggle.
   - Drag-and-drop calls `store.move`.
   - The check circle calls `store.complete`; the `+` FAB opens the form.
   - The second line of each row is one of: the alarm in orange ("⏰ 18:30 · bugün"), the start of the note, or "tarihsiz". Show a photo thumbnail when there is one.
3. Form:
   - Fields: title, note, one photo (camera or gallery), date, alarm, repeat.
   - Port the photo compression from v1 `lib/storage-idb.ts`, but output a Blob.
   - A one-off alarm with no date gets today's date, or tomorrow's if the time has already passed.
4. Wire it up:
   - Start `startSync` after login. Call `store.ensureBirthday()` after the first pull.
   - Show the 20 December easter egg (`public/easter-egg.png` in v1) when a task is saved for that day.
