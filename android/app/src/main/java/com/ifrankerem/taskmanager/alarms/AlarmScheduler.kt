package com.ifrankerem.taskmanager.alarms

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.ifrankerem.taskmanager.MainActivity
import java.time.ZoneId

/**
 * Sets one AlarmManager alarm clock per task (its next ring) plus one per
 * snooze, and cancels the ones that no longer exist. Safe to run any time:
 * it rebuilds everything from AlarmStore.
 */
object AlarmScheduler {
    const val ACTION_FIRE = "com.ifrankerem.taskmanager.alarms.FIRE"
    const val EXTRA_TASK = "taskId"
    const val EXTRA_OCCURRENCE = "occurrence"
    const val EXTRA_AT = "at"
    const val EXTRA_KIND = "kind"

    /** `key` is "task/<id>" or "snooze/<id>"; the data URI keeps each PendingIntent distinct. */
    private fun fireIntent(context: Context, key: String, extras: Intent.() -> Unit = {}): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).setAction(ACTION_FIRE).setData(Uri.parse("xp-alarm://$key")).apply(extras)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun reschedule(context: Context, now: Long = System.currentTimeMillis()) {
        val store = AlarmStore(context)
        val alarms = context.getSystemService(AlarmManager::class.java)
        val zone = ZoneId.systemDefault()
        val wanted = mutableSetOf<String>()

        val tasks = store.tasks()
        for (task in tasks) {
            val id = task.optString("id")
            val (occurrence, at) = AlarmMath.next(task, now, zone) ?: continue
            set(context, alarms, "task/$id", id, occurrence, at)
            wanted += "task/$id"
        }

        val open = tasks.filter { it.optString("status") == "open" }.map { it.optString("id") }.toSet()
        for ((id, snooze) in store.snoozes()) {
            val at = snooze.optLong("at")
            if (id in open && at > now) {
                set(context, alarms, "snooze/$id", id, snooze.optString("occurrence"), at)
                wanted += "snooze/$id"
            } else {
                store.clearSnooze(id)
            }
        }

        for (old in store.scheduled() - wanted) alarms.cancel(fireIntent(context, old))
        store.setScheduled(wanted)
    }

    private fun set(context: Context, alarms: AlarmManager, key: String, taskId: String, occurrence: String, at: Long) {
        val operation = fireIntent(context, key) {
            putExtra(EXTRA_TASK, taskId)
            putExtra(EXTRA_OCCURRENCE, occurrence)
            putExtra(EXTRA_AT, at)
            putExtra(EXTRA_KIND, key.substringBefore('/'))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarms.canScheduleExactAlarms()) {
            // Without the permission an alarm clock is refused; ring late rather than never.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
            return
        }
        val show = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        alarms.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), operation)
    }
}
