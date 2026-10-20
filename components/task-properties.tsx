"use client"

import type React from "react"
import { useState } from "react"
import type { Task } from "@/lib/task"
import RepeatEditor from "@/components/repeat-editor"
import { NO_REPEAT, toLegacyRepeats, toRepeatRule, type RepeatRule } from "@/lib/repeat-rule"
import { nextReminderText } from "@/lib/task-display"
import { compressImage } from "@/lib/storage-idb"
import { XpIcon } from "@/components/xp-icons"
import { XpAutoTextarea, XpCheckbox, XpDialog, XpMessage, XpWindow } from "@/components/xp-ui"

type Tab = "general" | "reminder" | "picture"

export type TaskDraft = Omit<Task, "id" | "createdDate" | "lastEditedDate">

interface TaskPropertiesProps {
  /** Omitted when creating a new task. */
  task?: Task
  initialDueDate?: string
  initialTab?: Tab
  /** New task: called once with the form. */
  onCreate?: (draft: TaskDraft) => void
  /** Existing task: called by OK and Apply with the changed fields. */
  onApply?: (updates: Partial<Task>) => void
  onToggleComplete?: () => void
  onDelete?: () => void
  onClose: () => void
}

const formatStamp = (date: Date) =>
  date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/**
 * The XP "Properties" sheet for a task. Viewing and editing are the same
 * thing here: fields are live, and OK/Apply write them back.
 */
export default function TaskProperties({
  task,
  initialDueDate,
  initialTab = "general",
  onCreate,
  onApply,
  onToggleComplete,
  onDelete,
  onClose,
}: TaskPropertiesProps) {
  const isNew = !task
  const [tab, setTab] = useState<Tab>(initialTab)
  const [title, setTitle] = useState(task?.title ?? "")
  const [detail, setDetail] = useState(task?.detail ?? "")
  const [dueDate, setDueDate] = useState(task?.dueDate ?? initialDueDate ?? "")
  const [alarmEnabled, setAlarmEnabled] = useState(Boolean(task?.alarm))
  const [alarmTime, setAlarmTime] = useState(task?.alarm ?? "12:00")
  const [repeatRule, setRepeatRule] = useState<RepeatRule>(task ? toRepeatRule(task) : NO_REPEAT)
  const [photo, setPhoto] = useState<string | undefined>(task?.photo ?? undefined)
  const [photoFile, setPhotoFile] = useState<File | undefined>(undefined)
  const [photoChanged, setPhotoChanged] = useState(false)
  const [completed, setCompleted] = useState(Boolean(task?.completed))
  const [dirty, setDirty] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setDirty(true)
  }

  const handlePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      const raw = reader.result as string
      compressImage(raw)
        .then((compressed) => setPhoto(compressed))
        .catch(() => setPhoto(raw))
      setPhotoChanged(true)
      setDirty(true)
    }
    reader.readAsDataURL(file)
  }

  const removePhoto = () => {
    setPhoto(undefined)
    setPhotoFile(undefined)
    setPhotoChanged(true)
    setDirty(true)
  }

  const alarm = alarmEnabled && alarmTime ? alarmTime : undefined
  const reminderNote = nextReminderText({ alarm, dueDate: dueDate || undefined, repeatRule, repeats: toLegacyRepeats(repeatRule) })

  const apply = () => {
    if (!task || !onApply) return
    const updates: Partial<Task> = {
      title: title.trim() || "Untitled Task",
      detail: detail || undefined,
      dueDate: dueDate || undefined,
      alarm,
      repeats: toLegacyRepeats(repeatRule),
      repeatRule,
      type: photo ? "picture" : "text",
    }
    if (photoChanged) updates.photo = photo ?? null
    onApply(updates)
    if (completed !== Boolean(task.completed)) onToggleComplete?.()
    setPhotoChanged(false)
    setDirty(false)
  }

  const create = () => {
    // The draft already carries the compressed photo (see handlePhoto), so the
    // raw File is no longer passed on and compressed a second time.
    onCreate?.({
      title: title.trim() || "Untitled Task",
      type: photoFile ? "picture" : "text",
      photo: photo || undefined,
      detail: detail || undefined,
      alarm,
      repeats: toLegacyRepeats(repeatRule),
      repeatRule,
      dueDate: dueDate || undefined,
    })
  }

  const tabs: Array<[Tab, string]> = [["general", "General"], ["reminder", "Reminder"], ["picture", "Picture"]]
  const windowTitle = isNew ? "New Task" : `${task.title} Properties`
  const thumb = photo
    ? <span className="xp-thumb is-photo" style={{ ["--s" as string]: "40px" }}><img src={photo} alt="" /></span>
    : <XpIcon name={isNew ? "newTask" : "doc"} size={40} />

  return (
    <XpWindow title={windowTitle} icon={isNew ? "newTask" : "doc"} kind="dialog" onDialogClose={onClose} label={isNew ? "Add Task" : "Task Properties"}>
      <form className="xp-props" onSubmit={(event) => event.preventDefault()}>
        <div className="xp-tabs" role="tablist" aria-label="Task properties">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`props-tab-${key}`}
              aria-controls={`props-panel-${key}`}
              aria-selected={tab === key}
              className="xp-tab"
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="xp-tabpanel" role="tabpanel" id="props-panel-general" aria-labelledby="props-tab-general" hidden={tab !== "general"}>
          <div className="xp-props-head">
            {thumb}
            <XpAutoTextarea
              className="xp-props-title"
              maxRows={5}
              enterKeyHint="done"
              aria-label="Title"
              value={title}
              onChange={(event) => edit(setTitle)(event.target.value)}
              onKeyDown={(event) => {
                // A title is one line: Enter moves on to the notes instead of
                // opening a row the task list will never show.
                if (event.key !== "Enter" || event.shiftKey) return
                event.preventDefault()
                event.currentTarget.blur()
                document.getElementById("props-details")?.focus()
              }}
              placeholder="What needs doing?"
              autoFocus={isNew}
            />
          </div>
          <div className="xp-rule" />
          <dl className="xp-kv">
            <dt>Type:</dt><dd>{photo ? "Task with picture" : "Text task"}</dd>
            <dt>Location:</dt><dd>{completed ? "Completed" : "My Tasks"}</dd>
          </dl>
          <div className="xp-rule" />
          <div className="xp-prow">
            <label htmlFor="props-due">Due date:</label>
            <input id="props-due" type="date" value={dueDate} onChange={(event) => edit(setDueDate)(event.target.value)} />
          </div>
          {task && (
            <dl className="xp-kv">
              <dt>Created:</dt><dd>{formatStamp(task.createdDate)}</dd>
              <dt>Modified:</dt><dd>{formatStamp(task.lastEditedDate)}</dd>
            </dl>
          )}
          <div className="xp-rule" />
          <div className="xp-pcol">
            <label htmlFor="props-details">Details:</label>
            <XpAutoTextarea
              id="props-details"
              className="xp-props-detail"
              enterKeyHint="enter"
              value={detail}
              onChange={(event) => edit(setDetail)(event.target.value)}
              placeholder="Notes, addresses, lists"
            />
          </div>
          {task && (
            <>
              <div className="xp-rule" />
              <div className="xp-prow">
                <span>Attributes:</span>
                <XpCheckbox checked={completed} onChange={edit(setCompleted)}>Completed</XpCheckbox>
              </div>
            </>
          )}
        </div>

        <div className="xp-tabpanel" role="tabpanel" id="props-panel-reminder" aria-labelledby="props-tab-reminder" hidden={tab !== "reminder"}>
          <fieldset className="xp-groupbox">
            <legend>Alarm</legend>
            <div className="xp-prow is-wide">
              <XpCheckbox checked={alarmEnabled} onChange={edit(setAlarmEnabled)}>Ring at this time</XpCheckbox>
              <input aria-label="Alarm time" type="time" value={alarmTime} onChange={(event) => edit(setAlarmTime)(event.target.value)} disabled={!alarmEnabled} />
            </div>
          </fieldset>
          <RepeatEditor value={repeatRule} onChange={edit(setRepeatRule)} idPrefix={isNew ? "add-task" : "task-detail"} />
          <p className="xp-note"><XpIcon name="bell" size={16} /><span>{reminderNote}</span></p>
        </div>

        <div className="xp-tabpanel" role="tabpanel" id="props-panel-picture" aria-labelledby="props-tab-picture" hidden={tab !== "picture"}>
          <div className="xp-pic-frame">
            {photo ? (
              <button type="button" className="xp-pic-open" onClick={() => setViewing(true)} aria-label="View picture full size">
                <img src={photo} alt={`Picture attached to ${title || "this task"}`} />
              </button>
            ) : (
              <div className="xp-pic-none"><XpIcon name="photo" size={48} /><span>No picture attached</span></div>
            )}
          </div>
          <div className="xp-row-buttons">
            <label className="xp-btn">
              <XpIcon name="openFolder" size={16} /> Browse…
              <input type="file" accept="image/*" onChange={handlePhoto} hidden />
            </label>
            <button type="button" className="xp-btn" onClick={removePhoto} disabled={!photo}>Remove</button>
          </div>
          <p className="xp-hint">{photo ? "Tap the picture to see it full size." : "Attach a photo of a receipt, a list or a document."}</p>
        </div>
      </form>

      <div className="xp-props-foot">
        {isNew ? (
          <>
            <button type="button" className="xp-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="xp-btn is-default" onClick={create}>Save Task</button>
          </>
        ) : (
          <>
            {onDelete && <button type="button" className="xp-btn is-left" onClick={() => setConfirmDelete(true)}>Delete</button>}
            <button type="button" className="xp-btn is-default" onClick={() => { if (dirty) apply(); onClose() }}>OK</button>
            <button type="button" className="xp-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="xp-btn" onClick={apply} disabled={!dirty}>Apply</button>
          </>
        )}
      </div>

      {viewing && photo && (
        <XpDialog
          title={`${title || "Task"} - Picture Viewer`}
          icon="photo"
          onClose={() => setViewing(false)}
          maxWidth={520}
          buttons={<button type="button" className="xp-btn is-default" onClick={() => setViewing(false)}>Close</button>}
        >
          <div className="xp-photo-view"><img src={photo} alt={`Picture attached to ${title || "this task"}`} /></div>
        </XpDialog>
      )}

      {confirmDelete && (
        <XpDialog
          title="Confirm Task Delete"
          icon="recycle"
          role="alertdialog"
          onClose={() => setConfirmDelete(false)}
          buttons={
            <>
              <button type="button" className="xp-btn is-default" onClick={() => { setConfirmDelete(false); onDelete?.() }} autoFocus>Yes</button>
              <button type="button" className="xp-btn" onClick={() => setConfirmDelete(false)}>No</button>
            </>
          }
        >
          <XpMessage icon="recycle">
            <p>Are you sure you want to delete “{task?.title}”?</p>
          </XpMessage>
        </XpDialog>
      )}
    </XpWindow>
  )
}
