package com.ifrankerem.taskmanager.alarms

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject

/** Bridge for web/src/lib/native-alarms.ts. */
@CapacitorPlugin(
    name = "XpAlarms",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class XpAlarmsPlugin : Plugin() {
    companion object {
        @Volatile private var instance: XpAlarmsPlugin? = null

        /** A button was pressed natively; the web layer drains the actions. */
        fun notifyActionsChanged() {
            instance?.notifyListeners("actionsChanged", JSObject())
        }

        private val FIELDS = listOf("id", "title", "note", "status", "createdAt", "date", "alarm", "repeat", "doneOn")
    }

    private val store by lazy { AlarmStore(context) }

    override fun load() {
        instance = this
    }

    @PluginMethod
    fun getActions(call: PluginCall) {
        call.resolve(JSObject().put("actions", JSArray(store.actions().map { JSObject(it.toString()) })))
    }

    @PluginMethod
    fun acknowledge(call: PluginCall) {
        val ids = call.getArray("ids")?.toList<String>() ?: emptyList()
        store.acknowledge(ids.toSet())
        call.resolve()
    }

    @PluginMethod
    fun replaceTasks(call: PluginCall) {
        val tasks = call.getArray("tasks") ?: return call.reject("tasks missing")
        val slim = (0 until tasks.length()).map { i ->
            val t = tasks.getJSONObject(i)
            JSONObject().apply { FIELDS.forEach { put(it, t.opt(it) ?: JSONObject.NULL) } }
        }
        store.replaceTasks(slim)
        AlarmScheduler.reschedule(context)
        call.resolve()
    }

    @PluginMethod
    fun permissions(call: PluginCall) = call.resolve(status())

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            requestPermissionForAlias("notifications", call, "notificationsAnswered")
        } else {
            call.resolve(status())
        }
    }

    @PermissionCallback
    private fun notificationsAnswered(call: PluginCall) = call.resolve(status())

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val pkg = Uri.parse("package:${context.packageName}")
        val intent = when (call.getString("kind")) {
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            "exact" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg) else null
            "fullScreen" -> if (Build.VERSION.SDK_INT >= 34) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg) else null
            // Samsung puts "Unrestricted" battery use on the app's info page.
            "battery" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
            "sound" -> Intent(Settings.ACTION_SOUND_SETTINGS)
            else -> null
        } ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
        activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    }

    private fun status(): JSObject {
        val notifications = context.getSystemService(NotificationManager::class.java)
        val alarms = context.getSystemService(AlarmManager::class.java)
        val audio = context.getSystemService(AudioManager::class.java)
        val power = context.getSystemService(PowerManager::class.java)
        val filter = notifications.currentInterruptionFilter
        val dndAllowsAlarms = when (filter) {
            NotificationManager.INTERRUPTION_FILTER_NONE -> false
            NotificationManager.INTERRUPTION_FILTER_PRIORITY ->
                notifications.notificationPolicy.priorityCategories and NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS != 0
            else -> true
        }
        return JSObject()
            .put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
            .put("exact", Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms())
            .put("fullScreen", Build.VERSION.SDK_INT < 34 || notifications.canUseFullScreenIntent())
            .put("battery", power.isIgnoringBatteryOptimizations(context.packageName))
            .put("alarmVolume", audio.getStreamVolume(AudioManager.STREAM_ALARM))
            .put("dndAllowsAlarms", dndAllowsAlarms)
    }
}
