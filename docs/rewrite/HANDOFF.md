# Handoff: xp-tasks v2 rewrite

For whoever continues this work in a new session. Read [PLAN.md](PLAN.md) and [BUGS.md](BUGS.md) first.

## State (2026-11-03)

| Phase | State |
| --- | --- |
| 1. PocketBase schema + runbook | Merged (#31) and live on devbox: `https://xp.irfankerem.com/api/` |
| 2. Data layer + sync + tests | Merged into `v2` (#32) |
| 3. Görevler + form | Merged into `v2` (#34) |
| 4. Takvim + task page | Implemented on `v2-phase4-calendar`; PR into `v2` for review (issue #35) |
| 5. Arşiv + Ayarlar | Next |
| 6–8. Native alarms, migration, cutover | Not started |

## How the work is done

- The owner requested direct implementation, without Orchestra worker/tester sessions.

- **Branches and PRs:** one PR per phase, from a branch off `v2` into `v2` (e.g. `v2-phase3-tasks`). Old code (root Next.js app, `worker/`, Firebase files) stays until the cutover PR.
- **Commits:**
  - Author: `ifrankerem <121255615+ifrankerem@users.noreply.github.com>`.
  - Format: Conventional Commits.
  - No AI attribution anywhere: no Co-Authored-By, no "Generated with" lines.
- **TDD** for logic. Before claiming that a test guards a rule, break the rule on purpose and check that the test fails.
- **The v2 app is in `web/`:** run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.
  - `npm run dev` starts Vite on port 5173. Its `/api/` proxy points to the existing PocketBase host.
  - Node 22.12+ (or 20.19+) is required by Vite; this devbox has Node 24 through nvm.
  - Inter is bundled locally. `web/dist/` is the v2 static build; the root build/deploy still belongs to v1.
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

## Phase 3 implementation

- `web/src/app.tsx`: email/password login, cached sessions, sync lifecycle, hash history, offline/auth status and the 20 December image. Sync starts after login and ensures the birthday once after the first successful pull.
- `web/src/tasks-screen.tsx`: Dexie live queries, Turkish title/note search, list/grid, complete and dnd-kit sorting with pointer/touch handles and keyboard support. Search disables dragging so filtered neighbors cannot corrupt manual order.
- `web/src/task-form.tsx`: add/edit, one photo from gallery/camera, date/alarm and every existing repeat kind. It writes only edited fields, so an unchanged field cannot overwrite a newer remote value.
- `web/src/lib/form.ts`: validation and the next-today-or-tomorrow rule for an undated one-off alarm.
- `web/src/lib/photo.ts`: JPEG Blob compression ported from v1.
- `web/src/task-photo.tsx`: local pending-photo previews and protected server photos. The server file field is protected and allows `240x240` thumbnails: `createPhotoUrl` in `api.ts` shares a short-lived file token within the session. Do not replace these with unsigned `/api/files/` URLs.
- `startSync` now ignores results after cleanup, preventing in-flight requests from resurrecting retry timers after logout/unmount.
- `#/yeni` opens the add form. Phase 4 adds task details and moves editing to `#/gorev/:id/duzenle`; archive/settings remain placeholders.
- No deployment, Firebase changes, or Android changes in phase 3.

Validation: 85 v2 tests including all 7 real PocketBase integration tests; 271 v1 tests; both TypeScript checks, worker typecheck, root lint, and both builds. The alarm-date, partial-edit, protected-photo and sync-cleanup tests were checked with deliberate failing mutations, then restored. Chromium checks covered mobile login/list/grid/form, keyboard reorder, local offline save/complete, reload with pending data/photos, and desktop sizing. Screenshots are under `~/inbox/out/xp-phase3-*.png` (not committed).

## Phase 4 implementation

- `web/src/calendar-screen.tsx`: Monday-first month grid, two ellipsized title chips per cell plus `+N`, alarm accents and the selected day's full list in manual order. All occurrences use the existing task rules.
- `web/src/lib/calendar.ts`: validates URL dates, builds complete calendar weeks and shifts months across year boundaries. Month and selected day are independent URL values: `#/takvim?ay=YYYY-MM&gun=YYYY-MM-DD`.
- Calendar selection/month changes replace the current history entry; opening details/forms pushes one. Browser/app Back restores the exact calendar URL, including after edit or add. There is no separate return-screen state.
- `web/src/task-page.tsx`: reads the current task by id from Dexie and shows title/date/alarm/repeat/note/photo. Complete and delete use Store methods; missing records and failed writes have visible states. Protected and pending photos reuse phase 3 handling.
- `#/gorev/:id?gun=YYYY-MM-DD` carries the selected occurrence; `#/gorev/:id/duzenle` edits it. Completion from the calendar or its detail page uses the selected occurrence date, leaving repeats open. Invalid occurrence queries fall back to the task's current occurrence.
- `#/yeni?gun=YYYY-MM-DD` prefills the date. `web/src/lib/use-now.ts` refreshes the list, calendar and detail clock on resume and every minute, reading the current date on each render.
- No new dependencies, data-layer changes, deployment, Firebase changes or Android changes.

Validation: 106 v2 tests including all 7 real PocketBase integration tests; 271 v1 tests; web/root TypeScript checks, worker typecheck, root lint and both builds. Deliberate mutations of calendar Back, selected-repeat completion, month-selection preservation and the two-chip limit each failed their guarding test; all mutations were restored. Chromium checks covered real browser Back, edit cancel/save, date-prefilled add, live detail updates/photos, selected-repeat completion, local delete/reload, mobile widths 320/360/393 and desktop width 1280, with API requests blocked. Screenshots are under `~/inbox/out/xp-phase4-*.png` (not committed). Root typecheck must run after the root build, rather than concurrently: the build replaces `.next/types`.

## Next: phase 5 (Arşiv + Ayarlar)

1. Start from `v2` after phase 4 is merged; create a separate phase branch and PR into `v2`.
2. Replace the archive placeholder with live archived tasks, distinguishing completed and deleted tasks. Use Store restore and permanent-delete operations; permanent delete asks for one confirmation and preserves the existing tombstone behavior.
3. Add account/logout and JSON backup export/import of all tasks, including photos. Preserve `id` and `position`; importing the same backup twice must not duplicate tasks or change their order.
4. Add the alarm-permission status area. Native permission inspection/deep links belong to phase 6; keep the web state honest about platform support.
5. Reuse the existing local-store/outbox path, photo handling, styles and hash history. Test archive/restore/purge and backup round trips, including repeat tasks and local pending photos. Do not remove the old app or deploy yet.

Offline data edits already persist in IndexedDB. App-shell/service-worker caching and the Android integration still belong to the later cutover/native work; do not claim a fresh browser can load the v2 shell without a network connection yet.
