# v2 plan and decisions

The brief is `~/inbox/xp-rewrite-master-prompt.md`. The bugs this design avoids are in [BUGS.md](BUGS.md).

Each phase is one PR into `v2`. The old code is removed only in the cutover PR.

1. PocketBase schema + runbook (`deploy/`)
2. Data layer + sync + tests
3. Görevler + form
4. Takvim + task page
5. Arşiv + Ayarlar
6. Native alarm module
7. Migration (`deploy/migrate/`)
8. Cutover

## Decisions

- **Login:** PocketBase email + password, one account, public sign-up closed. Google sign-in goes away.
- **Ids are made on the client** (`[a-z0-9]`, 8 to 32 characters). Migrated tasks keep their v1 ids.
- **Data path:** UI -> Dexie (task row + outbox entry in one transaction) -> sync -> PocketBase.
  - Pulls go through realtime, plus a catch-up by `updated`.
  - A record with pending outbox entries is not overwritten by a pull.
  - Writes patch only the fields that changed and always set absolute values; there are no toggles.
- **Archive:**
  - "Tamamlandı" sets `status=archived, archivedAs=done`; "Sil" sets `status=archived, archivedAs=deleted`.
  - On a repeating task, "Tamamlandı" sets only `doneOn` to that occurrence's date.
  - "Kalıcı sil" is the only real delete. Its id stays as a local tombstone, so the task cannot come back.
- **Order:** `position`, a fractional number. A drag writes only the moved task.
- **Repeat anchor:** the task's `date`, or else its `createdAt`. The same pure function serves the calendar, the list text and the alarms. The native side ports it, and both sides run against the same JSON test vectors.
- **Birthday task (kept from v1):** every year there must be one "İrfan Kerem Arslan DOGUM GÜNÜ" task on 20 December. It is created once, with a fixed id per year (`birthday` + year, e.g. `birthday2026`), so two devices opening at the same time still make one record.
  - v1 created it only when a task was added for 20 December. v2 makes sure it exists for the coming 20 December.
  - The easter-egg image stays and shows when a task is saved for 20 December.
- **Görevler:** a search box at the top (title and note). List/grid toggle. Manual order only. v1's grouping, multi-select and "Coming up" are dropped.
- **Takvim:**
  - The month view follows `~/inbox/xp-mockups/calendar-v2.html`.
  - Each day cell shows at most 2 short one-line title chips: cut with "…", orange when the task has an alarm, and "+N" for the rest. Cells are taller, but the month still fits on one screen.
  - Tapping a day shows that day's full list below the month.
  - The Schedule view is dropped.
  - Month and day live in the URL (`#/takvim?ay=YYYY-MM&gun=YYYY-MM-DD`), so Back restores them.
- **Task page:** the right phone in `calendar.html`, with buttons Tamamlandı · Düzenle · Sil.
- **Signing:** the old APK was probably signed with the laptop's `~/.android/debug.keystore`. In phase 6, compare the installed app's certificate and ask for that keystore if it matches.
