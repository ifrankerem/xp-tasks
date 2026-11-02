# Handoff: xp-tasks v2 rewrite

For whoever continues this work in a new session. Read [PLAN.md](PLAN.md) and [BUGS.md](BUGS.md) first.

## State (2026-11-03)

| Phase | State |
| --- | --- |
| 1. PocketBase schema + runbook | Merged (#31) and live on devbox: `https://xp.irfankerem.com/api/` |
| 2. Data layer + sync + tests | Merged into `v2` (#32) |
| 3. Görevler + form | Merged into `v2` (#34) |
| 4. Takvim + task page | PR #36 open into `v2` (issue #35) |
| 5. Arşiv + Ayarlar | Implemented on `v2-phase5-archive-settings`; PR into `v2` for review (issue #37), depends on #36 |
| 6. Native alarm module | PR into `v2-phase5-archive-settings` (stacked on #38) |
| 7–8. Migration, cutover | Not started |

## How the work is done

- The owner requested direct implementation, without Orchestra worker/tester sessions.

- **Branches and PRs:** one PR per phase, from a branch off `v2` into `v2` (e.g. `v2-phase3-tasks`). Old code (root Next.js app, `worker/`, Firebase files) stays until the cutover PR.
- The owner requested continued work while phase 4 is still open. Phase 5 starts from phase 4 commit `67c9e39`; merge #36 first and rebase phase 5 onto the updated `v2` so its PR shows only phase 5. Do not merge or deploy on the owner's behalf.
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
- `#/yeni` opens the add form. Phase 4 adds task details and moves editing to `#/gorev/:id/duzenle`; phase 5 implements archive/settings.
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

## Phase 5 implementation

- `web/src/archive-screen.tsx`: live archived tasks, all/completed/deleted filters, detail links, restore and permanent delete after one confirmation. Writes use the existing Store methods; errors remain visible and allow retry.
- `web/src/settings-screen.tsx`: account/logout, pending-write count, JSON download/upload, progress/results and honest browser alarm support. Logout keeps local data and pending writes. Native permission controls belong to phase 6.
- `web/src/lib/backup.ts`: portable JSON envelope `{format: "xp-tasks", version: 1, tasks: [...]}`. Each task includes its original id, position, all writable fields and `photo` as a data URL or null; server timestamps and server file names are omitted. Version 1 is the backup format version, not the old application's format.
- Export snapshots rows and pending photos together, then downloads original protected server photos through `api.ts`. Pending local photos take priority. Missing photos fail the export; no partial backup is downloaded.
- Import validates the entire file before writing, including field types, real dates, repeat rules, duplicate ids and supported photo types/sizes. `Store.importTasks` applies it atomically with the outbox. It preserves IDs/order, skips tombstones, leaves unrelated tasks alone and restores photos. Reimporting repeats absolute writes without duplicating records.
- A newly imported local ID queues create followed by update, so an existing server record with that ID still receives the imported fields/photos. Existing local IDs queue updates. Sync behavior itself is unchanged.
- No dependencies, production deployment, Firebase or Android changes. Legacy v1 backups are not this format; their conversion belongs to phase 7.

Validation: 131 v2 tests including 7 real PocketBase integration tests; 271 v1 tests; web/root TypeScript, worker typecheck, root lint and both builds. Mutations of imported IDs, tombstone checks, server-collision updates, purge confirmation and archive-reason validation each failed their intended test and were restored. Chromium passed at widths 320/360/393/1280 with production API requests blocked: photo-bearing backup download, repeated import, malformed-file rejection, archive/detail Back, restore, cancel/confirm purge, tombstone protection after reimport/reload, and logout with pending data retained. Screenshots: `~/inbox/out/xp-phase5-*.png` (not committed).

## Next: phase 6 (Native alarm module)

1. Read the native-alarm section in `~/inbox/xp-rewrite-master-prompt.md` and `~/inbox/xp-mockups/alarm.html`. Keep a separate phase branch and PR, preserving earlier pending PRs.
2. Implement a local Kotlin Capacitor plugin using `setAlarmClock`, persisted schedules, stable per-task request codes and a native action queue. Port repeat calculations and run the same JSON vectors on TypeScript and Kotlin.
3. Add looping alarm audio/vibration, the lock-screen activity and heads-up actions: complete, snooze 10 minutes/1 hour, dismiss. Stop unanswered ringing after about one minute with a missed notification. Reschedule after reboot, clock/time-zone change and app update.
4. Reconcile schedules from local Dexie state; drain native completion actions on launch/resume through Store, with acknowledgement only after local persistence. Snooze stays native.
5. Add notification/exact-alarm/full-screen permission status and settings links, plus Samsung battery guidance. Build the v2 web bundle into the debug APK without removing v1 before cutover.
6. Use the devbox SDK, roughly 3 GB Gradle heap and no emulator. Ask for wireless-debugging pairing details for phone tests; compare installed signing certificate before replacing the old app. Place the debug APK under `~/inbox/out/` and test screen-off, silent mode, reboot and every action on the device. Do not claim device validation without it.

Offline data edits already persist in IndexedDB. App-shell/service-worker caching and the Android integration still belong to the later cutover/native work; do not claim a fresh browser can load the v2 shell without a network connection yet.

## Phase 6 implementation

- `android/app/src/main/java/com/ifrankerem/taskmanager/alarms/`:
  - `AlarmMath.kt`: a port of `nextAlarm` and the repeat rules. It must pass `test-vectors/alarms.json`, the same vectors the web test (`web/test/alarm-vectors.test.ts`) runs. Change both sides together.
  - `AlarmStore.kt`: SharedPreferences with the alarm fields of each task, pending "Tamamlandı" actions, snoozes and stable notification ids.
  - `AlarmScheduler.kt`: one `setAlarmClock` per task plus one per snooze. It rebuilds everything from the store, so it is safe to run any time.
  - `AlarmReceiver.kt`: `AlarmReceiver` starts the ringing service. `RescheduleReceiver` sets alarms again after boot, a time or zone change, and an app update.
  - `AlarmService.kt`: a foreground service of type `mediaPlayback`.
    - It loops sound on `USAGE_ALARM`, vibrates, and posts a full-screen notification.
    - Buttons: Tamamlandı, 10 dk / 1 saat ertele, Kapat.
    - After 60 s without an answer it stops and leaves a "Kaçırıldı" notification.
    - It logs to tag `XpAlarm`.
  - `AlarmActivity.kt`: the black ringing screen over the lock screen.
  - `XpAlarmsPlugin.kt`: the bridge for `web/src/lib/native-alarms.ts`.
- `MainActivity.onResume` opens the ringing screen while an alarm rings, so the alarm can always be stopped, even if its notification never showed.
- Web:
  - `web/capacitor.config.ts` packages `web/dist` into `../android`. The root config still belongs to v1.
  - `main.tsx` uses `https://xp.irfankerem.com` inside the app, because the WebView's origin is `https://localhost`.
  - Ayarlar lists every alarm permission, with a "Düzelt" button for each missing one.
- Build:
  ```sh
  cd web && npm run build && npx cap sync android
  cd ../android && ./gradlew assembleDebug -PxpAlarmTest
  ```
  - `-PxpAlarmTest` builds `com.ifrankerem.taskmanager.alarmtest`, "Görevler (test)", which installs next to the old app.
  - Without the flag the build keeps `com.ifrankerem.taskmanager`. The phone's old app is not signed with devbox's debug key, so that build cannot replace it until the laptop keystore is used.
- Device tests on the S25 (Android 17), with A–D being the four test alarms:
  - Passed:
    - exact alarm clocks were set (`dumpsys alarm`);
    - a heads-up while the phone was in use, and tapping it opened the screen (A);
    - the full screen while locked (B);
    - 10 dk ertele (B rang again at +10 min);
    - Tamamlandı on a one-off task (C, archived in the app);
    - Tamamlandı on a daily task (D: next alarm set for tomorrow, the task stays open with that day done);
    - alarms were set again after an app update.
  - Not run, at the owner's request to stop testing: the 60 s timeout and "Kaçırıldı", Kapat, 1 saat, and reboot.
- Found during the device tests:
  - Without the notification permission the sound rang with nothing on screen to stop it. That led to the `onResume` fallback.
  - `appops` reports `USE_FULL_SCREEN_INTENT` rejected, yet Samsung still showed the full screen on the lock screen.
