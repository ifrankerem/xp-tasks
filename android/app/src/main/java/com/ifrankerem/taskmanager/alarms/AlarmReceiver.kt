package com.ifrankerem.taskmanager.alarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/** An alarm clock went off: hand it to the ringing service. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AlarmScheduler.ACTION_FIRE) return
        val ring = Intent(context, AlarmService::class.java).setAction(AlarmService.RING).putExtras(intent)
        ContextCompat.startForegroundService(context, ring)
    }
}

/** Alarm clocks do not survive a reboot, and a clock or zone change moves them: set them again. */
class RescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            -> AlarmScheduler.reschedule(context)
        }
    }
}
