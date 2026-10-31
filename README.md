<div align="center">

# 🖥️ xp-tasks

**A Windows XP-inspired, offline-first task manager — as a Progressive Web App and an installable Android build.**

![Next.js](https://img.shields.io/badge/Next.js%2015-000?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript)
![React](https://img.shields.io/badge/React%2019-61DAFB?style=flat-square&logo=react)
![Tailwind](https://img.shields.io/badge/Tailwind%20v4-38BDF8?style=flat-square&logo=tailwindcss)
![Firebase](https://img.shields.io/badge/Firestore-FFCA28?style=flat-square&logo=firebase)
![Capacitor](https://img.shields.io/badge/Capacitor-119EFF?style=flat-square&logo=capacitor)
![Live](https://img.shields.io/badge/demo-live-2b9348?style=flat-square)

</div>

<p align="center">
  <a href="https://xp.irfankerem.com">Try the live demo</a>
</p>

---

## ✨ Features

| Area | What it does |
|---|---|
| Tasks | create, edit, complete, archive with photo attachments |
| Organisation | drag-and-drop reordering, grid and list views |
| Alarms | one-off and weekly repeating alarms, native on Android/iOS, Web Push on iOS 16.4+ |
| Calendar | calendar view, `.ics` export for the system calendar |
| Offline | service worker caching, Firestore offline queue, JSON export/import |
| Install | add to home screen on desktop and mobile, standalone mode, hardware back button |
| Voice | build a task, complete, update, delete or list tasks from a spoken sentence (native builds only) |

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS v4, Radix Primitives |
| Drag & Drop | @dnd-kit |
| Sync | Firebase Firestore |
| Notifications | Capacitor Local Notifications + Cloudflare Worker Web Push |
| Charts & forms | Recharts, React Hook Form, Zod, Sonner |
| Theming | next-themes |

---

## 🚀 Getting Started

**Prerequisites:** Node.js 18.17+, npm/pnpm, `NEXT_PUBLIC_FIREBASE_*` env vars.

```sh
git clone https://github.com/ifrankerem/xp-tasks.git
cd xp-tasks
npm install
npm run dev          # http://localhost:3000
npm run build        # static site in out/; serve with nginx
```

**Scripts:** `npm run dev` · `npm run build` · `npm run deploy` · `npm run lint` · `npm test`

---

## 🔔 Notification Matrix

| Platform | Delivery | Works with the app closed |
|---|---|---|
| Web / iOS PWA | Web Push via Cloudflare Worker cron | yes |
| Web PWA (in-app) | Browser Notification API | foreground only |
| Android native | Capacitor Local Notifications | yes |
| iOS native | Capacitor Local Notifications | yes |
| Any platform | `.ics` calendar export | yes |

iOS background alarms need the Cloudflare Worker in `worker/` with
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` matching the worker's keys.

---

## 🎤 Voice Commands

The mic button on **My Tasks** (native builds) turns one spoken Turkish
sentence into a task command. Phrasing is decided on device by
`lib/voice-intent.ts`; when the rules can't read it, the app asks the
worker's `/voice-intent` endpoint for a suggestion. Deletions or completions
the model guessed at come back as a confirmation dialog — nothing changes
until you tap it.

---

## 🔒 Privacy

- Tasks live under the user's Firebase user ID — scoped per account
- Firebase Auth is required for sync
- No analytics, trackers or ad SDKs
- Full data portability via JSON export

---

## 📄 License

MIT

---

## 👤 Author

**İrfan Kerem Arslan** — [@ifrankerem](https://github.com/ifrankerem)

---

## 🙏 Acknowledgements

- [awesome-readme](https://github.com/matiassingers/awesome-readme) — structure inspiration for this README

## Static hosting

The web app lives at https://xp.irfankerem.com. `npm run build` exports the
complete site to `out/`. After merge, `npm run deploy` builds and runs
`rsync -a --delete out/ /srv/sites/xp/`; nginx serves that directory at the
origin root with HTTPS. Use directory indexes for exported routes
(`try_files $uri $uri/ =404;`), and allow `/sw.js` to revalidate on updates.
The manifest and service worker use root-relative URLs.

Keep the existing production `NEXT_PUBLIC_*` build variables, including Firebase
`authDomain` and the VAPID public key. Firebase Auth, Firestore and the push Worker
remain hosted where they are. Add `xp.irfankerem.com` to Firebase Authentication's
authorized domains before testing Google sign-in. Reinstall the PWA from the new
origin: browser storage, existing installations and push subscriptions belong to
the old origin and do not migrate automatically. Sign in and enable notifications
on the new site to register its push subscription.
