package com.ifrankerem.taskmanager.alarms

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import org.json.JSONObject

/**
 * Kotlin port of web/src/lib/repeat.ts + nextAlarm in task.ts. Both sides run
 * test-vectors/alarms.json; change them together.
 */
object AlarmMath {
    sealed interface Rule
    data class Daily(val interval: Int) : Rule
    data class Weekly(val days: Set<Int>, val interval: Int) : Rule // 0 = Sunday
    data class Monthly(val dayOfMonth: Int) : Rule

    private fun interval(v: Any?): Int {
        val n = (v as? Number)?.toInt() ?: return 1
        return if (n >= 1) minOf(n, 52) else 1
    }

    fun rule(raw: Any?): Rule? {
        val r = raw as? JSONObject ?: return null
        return when (r.optString("kind")) {
            "daily" -> Daily(interval(r.opt("interval")))
            "weekly" -> {
                val arr = r.optJSONArray("days") ?: return null
                val days = (0 until arr.length()).mapNotNull { (arr.opt(it) as? Number)?.toInt() }.filter { it in 0..6 }.toSet()
                if (days.isEmpty()) null else Weekly(days, interval(r.opt("interval")))
            }
            "monthly" -> (r.opt("dayOfMonth") as? Number)?.toInt()?.takeIf { it in 1..31 }?.let { Monthly(it) }
            else -> null
        }
    }

    private fun sundayFirst(day: LocalDate) = day.dayOfWeek.value % 7

    private fun mondayOf(day: LocalDate) = day.minusDays(((sundayFirst(day) + 6) % 7).toLong())

    fun occursOn(rule: Rule, anchor: LocalDate, day: LocalDate): Boolean {
        val elapsed = ChronoUnit.DAYS.between(anchor, day)
        if (elapsed < 0) return false
        return when (rule) {
            is Daily -> elapsed % rule.interval == 0L
            is Weekly -> sundayFirst(day) in rule.days &&
                Math.floorDiv(ChronoUnit.DAYS.between(mondayOf(anchor), day), 7L) % rule.interval == 0L
            is Monthly -> day.dayOfMonth == minOf(rule.dayOfMonth, day.lengthOfMonth())
        }
    }

    fun nextOccurrence(rule: Rule, anchor: LocalDate, from: LocalDate): LocalDate? {
        var day = if (from.isBefore(anchor)) anchor else from
        repeat(381) {
            if (occursOn(rule, anchor, day)) return day
            day = day.plusDays(1)
        }
        return null
    }

    private fun str(task: JSONObject, key: String): String? =
        if (task.isNull(key)) null else task.optString(key).takeIf { it.isNotEmpty() }

    private fun day(value: String?): LocalDate? =
        value?.takeIf { Regex("""\d{4}-\d{2}-\d{2}""").matches(it) }?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

    private fun time(value: String?): LocalTime? =
        value?.let { Regex("""([01]\d|2[0-3]):([0-5]\d)""").matchEntire(it) }
            ?.let { LocalTime.of(it.groupValues[1].toInt(), it.groupValues[2].toInt()) }

    fun anchorOf(task: JSONObject, zone: ZoneId): LocalDate =
        day(str(task, "date")) ?: Instant.ofEpochMilli(task.optLong("createdAt")).atZone(zone).toLocalDate()

    fun isRepeating(task: JSONObject) = rule(task.opt("repeat")) != null

    /** The next ring as (occurrence day 'YYYY-MM-DD', epoch ms), or null. */
    fun next(task: JSONObject, now: Long, zone: ZoneId): Pair<String, Long>? {
        if (task.optString("status") != "open") return null
        val at = time(str(task, "alarm")) ?: return null
        val ringAt = { d: LocalDate -> d.atTime(at).atZone(zone).toInstant().toEpochMilli() }
        val anchor = anchorOf(task, zone)
        val rule = rule(task.opt("repeat"))

        if (rule == null) {
            val ms = ringAt(anchor)
            return if (ms > now) anchor.toString() to ms else null
        }

        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val doneOn = day(str(task, "doneOn"))
        val from = if (doneOn != null && !doneOn.isBefore(today)) doneOn.plusDays(1) else today
        var d = nextOccurrence(rule, anchor, from)
        repeat(2) {
            val current = d ?: return null
            if (ringAt(current) > now) return current.toString() to ringAt(current)
            d = nextOccurrence(rule, anchor, current.plusDays(1))
        }
        return null
    }
}
