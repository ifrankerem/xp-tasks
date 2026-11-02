// Initial schema for xp-tasks v2: server settings, the single-owner `users`
// collection, and `tasks`.

const DATE = "^\\d{4}-\\d{2}-\\d{2}$"
const TIME = "^([01]\\d|2[0-3]):[0-5]\\d$"
const OWNER = "owner = @request.auth.id"

migrate((app) => {
  const settings = app.settings()
  settings.meta.appName = "xp-tasks"
  settings.meta.appURL = "https://xp.irfankerem.com"
  // nginx sets X-Real-IP from Cloudflare's CF-Connecting-IP; without it every
  // request looks like 127.0.0.1 and the rate limiter would block everyone at once.
  settings.trustedProxy.headers = ["X-Real-IP"]
  settings.rateLimits.enabled = true
  settings.rateLimits.rules = [
    { label: "*:auth", maxRequests: 5, duration: 60 },
    { label: "/api/", maxRequests: 300, duration: 10 },
  ]
  settings.batch.enabled = true
  settings.batch.maxRequests = 50
  // Consistent zip snapshots inside pb_data/backups, which restic then picks up.
  settings.backups.cron = "0 3 * * *"
  settings.backups.cronMaxKeep = 7
  settings.logs.maxDays = 14
  app.save(settings)

  const users = app.findCollectionByNameOrId("users")
  users.createRule = null // no public sign-up; the one account is made in the dashboard
  users.listRule = "id = @request.auth.id"
  users.viewRule = "id = @request.auth.id"
  users.updateRule = "id = @request.auth.id"
  users.deleteRule = null
  users.oauth2.enabled = false
  users.otp.enabled = false
  users.mfa.enabled = false
  users.authAlert.enabled = false // no SMTP is configured
  users.passwordAuth.enabled = true
  users.passwordAuth.identityFields = ["email"]
  app.save(users)

  const tasks = new Collection({
    type: "base",
    name: "tasks",
    listRule: OWNER,
    viewRule: OWNER,
    createRule: "@request.auth.id != '' && @request.body.owner = @request.auth.id",
    updateRule: OWNER + " && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)",
    deleteRule: OWNER,
    fields: [
      // Ids are made on the client so a retried create cannot duplicate a task.
      // Wider than the default 15 chars so migrated v1 ids and the fixed
      // birthday ids keep their value.
      {
        name: "id",
        type: "text",
        system: true,
        primaryKey: true,
        required: true,
        min: 8,
        max: 32,
        pattern: "^[a-z0-9]+$",
        autogeneratePattern: "[a-z0-9]{15}",
      },
      { name: "owner", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: false },
      { name: "title", type: "text", required: true, max: 500 },
      { name: "note", type: "text", max: 20000 },
      {
        name: "photo",
        type: "file",
        maxSelect: 1,
        maxSize: 10 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        thumbs: ["240x240"],
        protected: true,
      },
      { name: "date", type: "text", pattern: DATE }, // local calendar day, no time zone
      { name: "alarm", type: "text", pattern: TIME }, // local HH:MM
      { name: "repeat", type: "json", maxSize: 2000 }, // RepeatRule, null = no repeat
      { name: "position", type: "number" }, // manual order, ascending
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "archived"] },
      { name: "archivedAs", type: "select", maxSelect: 1, values: ["done", "deleted"] },
      { name: "archivedAt", type: "number", onlyInt: true }, // epoch ms
      { name: "doneOn", type: "text", pattern: DATE }, // last completed occurrence of a repeating task
      { name: "createdAt", type: "number", required: true, onlyInt: true, min: 1 }, // epoch ms, kept from v1
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_tasks_owner_updated ON tasks (owner, updated)"],
  })
  app.save(tasks)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("tasks"))
})
