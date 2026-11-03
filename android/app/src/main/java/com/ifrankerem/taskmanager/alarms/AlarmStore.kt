package com.ifrankerem.taskmanager.alarms

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The native side's own copy of what it needs while the app is closed:
 *   tasks    alarm fields of every task the web layer last sent
 *   actions  "Tamamlandı" presses the web layer has not applied yet
 *   snoozes  taskId -> { at, occurrence }
 *   codes    taskId -> small stable int, for notification ids
 */
class AlarmStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("xp_alarms", Context.MODE_PRIVATE)

    private fun array(key: String) = JSONArray(prefs.getString(key, "[]"))
    private fun obj(key: String) = JSONObject(prefs.getString(key, "{}")!!)

    @Synchronized fun tasks(): List<JSONObject> = array("tasks").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }

    @Synchronized fun task(id: String): JSONObject? = tasks().firstOrNull { it.optString("id") == id }

    @Synchronized fun replaceTasks(tasks: List<JSONObject>) {
        // A press the web layer has not applied yet must not be undone by its older copy.
        val pending = actions()
        val merged = tasks.map { t -> pending.filter { it.optString("taskId") == t.optString("id") }.fold(t) { acc, a -> applyDone(acc, a.optString("occurrence")) } }
        prefs.edit().putString("tasks", JSONArray(merged).toString()).commit()
    }

    @Synchronized fun markDone(taskId: String, occurrence: String, at: Long): JSONObject {
        val action = JSONObject().put("id", "a$at-$taskId").put("taskId", taskId).put("occurrence", occurrence).put("at", at)
        val actions = array("actions").put(action)
        val tasks = tasks().map { if (it.optString("id") == taskId) applyDone(it, occurrence) else it }
        prefs.edit().putString("actions", actions.toString()).putString("tasks", JSONArray(tasks).toString()).commit()
        return action
    }

    private fun applyDone(task: JSONObject, occurrence: String): JSONObject {
        val copy = JSONObject(task.toString())
        if (AlarmMath.isRepeating(copy)) {
            val done = if (copy.isNull("doneOn")) "" else copy.optString("doneOn")
            if (occurrence > done) copy.put("doneOn", occurrence)
        } else {
            copy.put("status", "archived")
        }
        return copy
    }

    @Synchronized fun actions(): List<JSONObject> = array("actions").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }

    @Synchronized fun acknowledge(ids: Set<String>) {
        val left = actions().filter { it.optString("id") !in ids }
        prefs.edit().putString("actions", JSONArray(left).toString()).commit()
    }

    @Synchronized fun snoozes(): Map<String, JSONObject> = obj("snoozes").let { o -> o.keys().asSequence().associateWith { o.getJSONObject(it) } }

    @Synchronized fun setSnooze(taskId: String, at: Long, occurrence: String) {
        prefs.edit().putString("snoozes", obj("snoozes").put(taskId, JSONObject().put("at", at).put("occurrence", occurrence)).toString()).commit()
    }

    @Synchronized fun clearSnooze(taskId: String) {
        prefs.edit().putString("snoozes", obj("snoozes").apply { remove(taskId) }.toString()).commit()
    }

    /** Never reused for another task, so one task's notification never replaces another's. */
    @Synchronized fun code(taskId: String): Int {
        val codes = obj("codes")
        if (codes.has(taskId)) return codes.getInt(taskId)
        val next = prefs.getInt("nextCode", 1000)
        prefs.edit().putString("codes", codes.put(taskId, next).toString()).putInt("nextCode", next + 2).commit()
        return next
    }

    /** Ids that currently have an alarm set, so the next pass can cancel the rest. */
    @Synchronized fun scheduled(): Set<String> = array("scheduled").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }

    @Synchronized fun setScheduled(ids: Set<String>) {
        prefs.edit().putString("scheduled", JSONArray(ids.toList()).toString()).commit()
    }
}
