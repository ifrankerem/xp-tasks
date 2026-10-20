"use client"

import { useEffect, useState } from "react"
import { XpIcon, type XpIconName } from "@/components/xp-icons"
import { XpDialog, START_BUMP_EVENT } from "@/components/xp-ui"
import type { Screen } from "@/lib/task"
import type { MissedAlarm } from "@/lib/missed-alarms"

export function Wallpaper() {
  return (
    <div className="xp-wallpaper" aria-hidden="true">
      <svg className="xp-hills" viewBox="0 0 390 470" preserveAspectRatio="none">
        <path d="M0 150C70 90 160 70 260 92C320 104 360 120 390 140V470H0z" style={{ fill: "var(--xp-hill2)" }} />
        <path d="M0 225C110 130 250 128 390 196V470H0z" style={{ fill: "var(--xp-hill1)" }} />
        <path d="M0 225C110 130 250 128 390 196V214C260 158 120 160 0 250z" style={{ fill: "rgba(255,255,255,.2)" }} />
        <path d="M0 380C120 330 260 340 390 360V470H0z" style={{ fill: "var(--xp-hill3)", opacity: 0.55 }} />
      </svg>
    </div>
  )
}

const DESKTOP_ICONS: Array<{ screen: Screen; icon: XpIconName; label: string }> = [
  { screen: "tasks", icon: "folderTasks", label: "My Tasks" },
  { screen: "calendar", icon: "calendar", label: "Calendar" },
  { screen: "completed", icon: "folderDone", label: "Completed" },
  { screen: "settings", icon: "gear", label: "Settings" },
]

export function DesktopIcons({ onOpen }: { onOpen: (screen: Screen, origin: Element) => void }) {
  return (
    <>
      <div className="xp-desktop-icons">
        {DESKTOP_ICONS.map(({ screen, icon, label }) => (
          <button key={screen} type="button" className="xp-desktop-icon" onClick={(event) => onOpen(screen, event.currentTarget)}>
            <XpIcon name={icon} size={44} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <p className="xp-desktop-hint">Tap an icon or the start button to open a window.</p>
    </>
  )
}

function useClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : ""
}

interface TaskbarProps {
  startOpen: boolean
  onStart: () => void
  windowButton: { title: string; icon: XpIconName; active: boolean } | null
  onWindowButton: () => void
  missedCount: number
  onReminders: () => void
}

export function Taskbar({ startOpen, onStart, windowButton, onWindowButton, missedCount, onReminders }: TaskbarProps) {
  const clock = useClock()
  const [bump, setBump] = useState(0)

  useEffect(() => {
    const onBump = () => setBump((value) => value + 1)
    window.addEventListener(START_BUMP_EVENT, onBump)
    return () => window.removeEventListener(START_BUMP_EVENT, onBump)
  }, [])

  return (
    <div className="xp-taskbar">
      <button
        key={bump}
        type="button"
        className={`xp-start${bump ? " is-bump" : ""}`}
        data-xp-start
        aria-label="Start menu"
        aria-expanded={startOpen}
        onClick={onStart}
      >
        <XpIcon name="logo" size={22} />
        <span>start</span>
        {bump > 0 && <b className="xp-plus1" aria-hidden="true">+1</b>}
      </button>
      <div className="xp-taskbar-windows">
        {windowButton && (
          <button
            type="button"
            className={`xp-winbtn${windowButton.active ? " is-active" : ""}`}
            data-xp-winbtn
            onClick={onWindowButton}
            aria-label={`${windowButton.title} window`}
          >
            <XpIcon name={windowButton.icon} size={18} />
            <span>{windowButton.title}</span>
          </button>
        )}
      </div>
      <div className="xp-tray">
        <XpIcon name="sync" size={16} />
        <button type="button" onClick={onReminders} aria-label={missedCount ? `${missedCount} missed reminders` : "Reminders"}>
          <XpIcon name="bell" size={17} className={missedCount ? "xp-ring" : undefined} />
          {missedCount > 0 && <span className="xp-tray-count">{missedCount}</span>}
        </button>
        <span>{clock}</span>
      </div>
    </div>
  )
}

export function LogOffDialog({ onLogOff, onCancel }: { onLogOff: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  return (
    <div className="xp-modal is-full">
      <div className="xp-logoff" role="alertdialog" aria-modal="true" aria-label="Log Off Task Manager">
        <div className="xp-logoff-head"><span>Log Off Task Manager</span><XpIcon name="logo" size={26} /></div>
        <div className="xp-logoff-body">
          <button type="button" className="xp-logoff-choice" onClick={onLogOff}>
            <XpIcon name="switchUser" size={44} />Switch Account
          </button>
          <button type="button" className="xp-logoff-choice" onClick={onLogOff}>
            <XpIcon name="logoff" size={44} />Log Off
          </button>
        </div>
        <div className="xp-logoff-foot">
          <span className="xp-band-line" />
          <button type="button" className="xp-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function RemindersDialog({
  missed,
  onOpenTask,
  onDismissAll,
  onClose,
}: {
  missed: MissedAlarm[]
  onOpenTask: (missed: MissedAlarm) => void
  onDismissAll: () => void
  onClose: () => void
}) {
  const count = missed.length
  return (
    <XpDialog
      title={count === 1 ? "1 Reminder" : `${count} Reminders`}
      icon="bell"
      onClose={onClose}
      role="alertdialog"
      buttons={
        count > 0 ? (
          <>
            <button type="button" className="xp-btn" onClick={onDismissAll}>Dismiss All</button>
            <button type="button" className="xp-btn is-default" onClick={onClose}>Close</button>
          </>
        ) : (
          <button type="button" className="xp-btn is-default" onClick={onClose}>OK</button>
        )
      }
    >
      <div className="xp-reminder-top">
        <XpIcon name="bell" size={36} className={count ? "xp-ring" : undefined} />
        <div>
          <b>{count ? "Missed while the app was closed" : "No missed reminders"}</b>
          <small>{count ? "Tap a reminder to open its task." : "Reminders that ring while the app is closed show up here."}</small>
        </div>
      </div>
      {count > 0 && (
        <div className="xp-reminder-list">
          <div className="xp-reminder-head"><span>Subject</span><span>Rang at</span></div>
          {missed.map((alarm) => (
            <button key={alarm.id} type="button" className="xp-reminder-row" onClick={() => onOpenTask(alarm)}>
              <span>{alarm.title}</span>
              <span>{new Date(alarm.fireAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ height: 4 }} />
    </XpDialog>
  )
}

export function BootScreen() {
  return (
    <main className="xp-boot" aria-busy="true" aria-live="polite">
      <div className="xp-boot-in">
        <div className="xp-boot-mark">
          <XpIcon name="logo" size={76} />
          <strong>Task Manager</strong>
          <small>Loading your account…</small>
        </div>
        <div className="xp-bootbar" role="progressbar" aria-label="Loading"><i /></div>
      </div>
    </main>
  )
}

export function WelcomeScreen({ message }: { message: string }) {
  return (
    <main className="xp-welcome" aria-busy="true" aria-live="polite">
      <div className="xp-welcome-band is-top" />
      <div className="xp-welcome-mid">
        <span className="xp-welcome-word">welcome</span>
        <span className="xp-welcome-msg">{message}</span>
      </div>
      <div className="xp-welcome-band"><span className="xp-band-line" /></div>
    </main>
  )
}
