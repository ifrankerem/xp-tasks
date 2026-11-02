# Bugs in xp-tasks v1 and how v2 avoids them

Found by reading the code at `main` (`f4beb35`). Each entry lists the symptom, the root cause, and the rule v2 follows so the bug cannot come back. Line numbers refer to that commit.

## A. Delete does not stick

### A1. A second delete within 6 seconds cancels the first one

- **Symptom:** delete task A, then delete task B a few seconds later. B goes away; A comes back the next time the list is shown.
- **Cause:** `armPendingDelete` (`app/page.tsx:590-602`) clears the previous timer and replaces the pending entry with the new ids. The ids from the first delete are never committed.
- **v2:** no delayed delete. "Sil" writes `status = archived` locally at once, and the change goes into the outbox. Undo is a normal restore.

### A2. A pending delete lives only in memory

- **Symptom:** delete a task, then switch apps or lock the phone. The task is back the next time you open the app.
- **Cause:** the real write waits for a 6 second `setTimeout` (`app/page.tsx:594`). Android pauses timers in a WebView that is in the background, and kills the process later. The unmount cleanup (`app/page.tsx:614-621`) never runs when the process is killed.
- **v2:** every write is persisted to IndexedDB (the task row and its outbox entry, in one transaction) before the UI updates. Nothing important is kept only in timers.

### A3. "Hidden" deleted tasks come back when you change screens

- **Symptom:** delete a task, open Calendar or a task, go back. The deleted task is visible again until the timer fires.
- **Cause:** the grid hides the task using its own state, `hiddenIds` (`components/tasks-grid-screen.tsx:211, 274`). That state resets when the grid unmounts. The page's pending delete is a separate copy of the same state, and the two drift apart. For example, `openTask` commits the grid's copy (`:307`) but leaves the page's copy and its Undo on screen. Undo then reports "Delete undone" for a delete that was already sent.
- **v2:** one source of truth. Screens read tasks from the local store (Dexie live queries). They keep no copies of task state.

### A4. Reordering brings back deleted tasks and overwrites changes made elsewhere

- **Symptom:** a task deleted or completed on the laptop comes back after the phone reorders the list. Fields edited on another device revert.
- **Cause:** a reorder rewrites **every** task in full with `batch.set(..., { merge: true })`, using the phone's React state (`app/page.tsx:760-786`, `lib/storage-cloud.ts:186-212`). `set` creates a document that no longer exists, and every field is written with whatever value this device last saw.
- **v2:** a reorder writes one field, `position`, on the task that moved (fractional ordering). Sync patches only the fields that changed. An update never creates a record, and records are created only by an explicit create.

## B. Complete is not idempotent

### B1. Complete is a toggle based on the local copy

- **Symptom:** a task marked done turns open again. Double taps, Undo, and Apply in Properties can flip it the wrong way.
- **Cause:** `toggleCloudTaskComplete` writes `!currentCompleted` (`lib/storage-cloud.ts:175-184`). Undo calls the same toggle again (`components/tasks-grid-screen.tsx:404, 415`). Properties toggles when its own copy differs from a possibly stale `task` (`components/task-properties.tsx:113`). If two toggles are queued, or the local copy is old, the result is the wrong state.
- **v2:** every operation writes an absolute value (`status: 'archived'`, `doneOn: '2026-11-02'`). Repeating an operation leaves the same result, so a retried sync is safe.

### B2. Completing a repeating task ends its repeats

- **Symptom:** a weekly task marked done disappears from My Tasks and its alarm never rings again.
- **Cause:** completion sets `completed: true` and cancels the alarm (`app/page.tsx:469-503`). There is no notion of completing one occurrence.
- **v2:** for a repeating task, "Tamamlandı" records only that occurrence (`doneOn` = that date). The task stays open and the next alarm stays scheduled. Only "Sil" archives a repeating task.

## C. Calendar does not stay where you tapped

### C1. Back from a task returns to today, not the selected day

- **Symptom:** in Calendar, go to next month, tap the 14th, open a task, press Back. The calendar shows the current month and today.
- **Cause:** month and selected day are local `useState` in `CalendarScreen` (`components/calendar-screen.tsx:41-44`). The page renders only one screen at a time (`app/page.tsx:803-814`), so opening a task unmounts the calendar and loses that state. The same happens after "New task on ..." and cancelling or saving.
- **v2:** the month and day live in the URL (`#/takvim?ay=2026-12&gun=2026-12-14`). Back is `history.back()`, both in the app and for the Android back button, so it returns to exactly the same screen state.

### C2. Android back from Calendar always goes to My Tasks

- **Cause:** the hand-written back handler (`app/page.tsx:347-349`) hard-codes `'calendar' -> 'tasks'` and has its own idea of `returnScreen`. That idea also drifts: `handleTaskClick` and `handleNavigate` each update it with different rules (`:365, 373`).
- **v2:** a router owns navigation history. There is no `returnScreen`.

### C3. Changing months jumps the selection to the 1st

- **Cause:** `changeMonth` sets `selected` to day 1 of the new month (`components/calendar-screen.tsx:57-62`), so the list below shows a day you did not tap.
- **v2:** ‹ › change only the month. The selected day changes only when you tap a day.

### C4. "Today" freezes at mount

- **Cause:** `const [today] = useState(() => new Date())` (`components/calendar-screen.tsx:41`). If the app stays open past midnight, the today marker and the one-off alarms shown for today stay on yesterday.
- **v2:** today is read when rendering and refreshed when the app resumes.

### C5. Repeating tasks appear on the wrong days

- **Cause:** `ruleOccursOnDate` uses the date being tested as its own anchor when a task has no due date (`lib/repeat-rule.ts:291`). As a result:
  - "every 2 days" shows on every day;
  - "every 2 weeks" shows every week;
  - repeating tasks show on dates before their start.
- **v2:** each repeating task has a fixed anchor, its date or else its creation date. Occurrence math is a pure, tested function shared by the calendar, the list text, and alarm scheduling.

## D. Alarms

### D1. Alarm schedules drift

- **Cause:** `nextRepeatOccurrence` anchors "every N" rules on `after` (now) when there is no due date (`lib/repeat-rule.ts:267`). Every rebuild, which happens on every app launch, moves the schedule.
- **v2:** fixed anchor, as in C5.

### D2. Most repeats ring once and then stop

- **Cause:** only weekly/interval 1 rules get a native repeating schedule. Daily, every-N and monthly rules schedule just the next occurrence (`lib/notifications.ts:163-195`), and the next one is scheduled only when the app is open again.
- **v2:** the native module reschedules the next occurrence itself after each ring, after a reboot, after a time change, and after an app update.

### D3. Alarms are notifications, not alarms

- **Cause:** a notification channel with no alarm audio attributes (`lib/notifications.ts:37`). It is silenced by silent mode and Do Not Disturb, does not loop, and does not open over the lock screen.
- **v2:** `setAlarmClock` + a full-screen intent + `USAGE_ALARM` looping sound (native module, phase 6).

### D4. Offline edits do not reschedule or cancel alarms

- **Cause:** `handleToggleComplete` and `handleUpdateTask` `await` the Firestore write before changing alarms (`app/page.tsx:474-503, 517-555`). Offline, that promise does not settle until the server acknowledges the write, so a task completed offline still rings, and a changed alarm time is not applied.
- **v2:** the alarm schedule is derived from the local store after each local write, never from server round-trips.

### D5. Notification id hash collisions

- **Cause:** 32-bit string hash + `Math.abs` (`lib/notifications.ts:19`). Two tasks can share an id, and cancelling one then cancels the other. `Math.abs(-2^31)` overflows a Java `int`.
- **v2:** the native side keys alarms by task id in its own store and derives request codes from a stable per-task integer it assigns.

## E. Data and state

### E1. Screens show stale copies of a task

- **Cause:** `selectedTask` is a copy made when the task was tapped (`app/page.tsx:99, 366`). Sync updates do not reach it. `handleUpdateTask` also writes from a stale `tasks` closure (`app/page.tsx:526, 558`) and can undo a sync that arrived in between.
- **v2:** the task page loads by id from the store (`#/gorev/:id`) and re-renders whenever the store changes.

### E2. Import duplicates tasks and loses order

- **Cause:** import calls `createCloudTask` with a new id for every row (`components/settings-screen.tsx:221-236`), so importing twice doubles everything. Export writes the screen `Task` shape, which has no `sortOrder` (`lib/task.ts`). Every imported task gets `sortOrder = -Date.now()`.
- **v2:** export carries `id` and `position`. Import upserts by id, so it is idempotent.

### E3. Photos are capped by Firestore's 1 MB document limit

- **Cause:** a photo is a base64 data URL inside the task document (`lib/storage-idb.ts:87`), compressed until it fits. Every snapshot also transfers every photo.
- **v2:** PocketBase file field. The list shows a server-side thumbnail (`?thumb=`). The same client compression is kept for upload size.

### E4. Too many writers

- **Cause:** the native notifications, the web foreground timers, the Firestore schedule mirror for the Worker, and the missed-alarm docs each keep their own idea of the schedule, rebuilt from different places in `app/page.tsx`.
- **v2:** one path: UI -> local store -> outbox -> server. Alarms are derived from the local store in one place.
