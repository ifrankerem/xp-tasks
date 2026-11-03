package com.ifrankerem.taskmanager.alarms

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.ifrankerem.taskmanager.MainActivity
import com.ifrankerem.taskmanager.R

/**
 * Rings one alarm: a looping alarm-stream sound (heard in silent mode and Do
 * Not Disturb, like the clock app), vibration, and a full-screen notification.
 * Stops on a button, or after a minute with a "kaçırıldı" notification.
 */
class AlarmService : Service() {
    companion object {
        const val RING = "com.ifrankerem.taskmanager.alarms.RING"
        const val DONE = "com.ifrankerem.taskmanager.alarms.DONE"
        const val SNOOZE = "com.ifrankerem.taskmanager.alarms.SNOOZE"
        const val DISMISS = "com.ifrankerem.taskmanager.alarms.DISMISS"
        const val STOPPED = "com.ifrankerem.taskmanager.alarms.STOPPED"
        const val EXTRA_MINUTES = "minutes"
        private const val RING_CHANNEL = "xp_alarm_ring"
        private const val MISSED_CHANNEL = "xp_alarm_missed"
        private const val TIMEOUT_MS = 60_000L

        /** The alarm on screen right now: (taskId, occurrence). Read by AlarmActivity. */
        @Volatile var ringing: Pair<String, String>? = null
            private set

        fun action(context: Context, action: String, taskId: String, occurrence: String, minutes: Int = 0): Intent =
            Intent(context, AlarmService::class.java).setAction(action)
                .putExtra(AlarmScheduler.EXTRA_TASK, taskId)
                .putExtra(AlarmScheduler.EXTRA_OCCURRENCE, occurrence)
                .putExtra(EXTRA_MINUTES, minutes)
    }

    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var ringingAt = 0L
    private val timeout = Runnable { ringing?.let { (id, occurrence) -> missed(id, occurrence); finish() } }
    private val store by lazy { AlarmStore(this) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(AlarmScheduler.EXTRA_TASK)
        val occurrence = intent?.getStringExtra(AlarmScheduler.EXTRA_OCCURRENCE)
        if (id == null || occurrence == null) {
            if (ringing == null) stopSelf()
            return START_NOT_STICKY
        }
        Log.i("XpAlarm", "${intent.action?.substringAfterLast('.')} task=$id occurrence=$occurrence")
        when (intent.action) {
            RING -> ring(id, occurrence, intent.getStringExtra(AlarmScheduler.EXTRA_KIND), intent.getLongExtra(AlarmScheduler.EXTRA_AT, System.currentTimeMillis()))
            DONE -> {
                store.markDone(id, occurrence, System.currentTimeMillis())
                store.clearSnooze(id)
                XpAlarmsPlugin.notifyActionsChanged()
                finish()
            }
            SNOOZE -> {
                store.setSnooze(id, System.currentTimeMillis() + intent.getIntExtra(EXTRA_MINUTES, 10) * 60_000L, occurrence)
                finish()
            }
            DISMISS -> finish() // one-off: spent; repeating: the next occurrence is already set
        }
        return START_NOT_STICKY
    }

    private fun ring(id: String, occurrence: String, kind: String?, at: Long) {
        val task = store.task(id)
        if (kind == "snooze") store.clearSnooze(id)
        // The next occurrence is set now, so it rings even if this one is never answered.
        AlarmScheduler.reschedule(this, maxOf(System.currentTimeMillis(), at + 1))
        if (task == null || task.optString("status") != "open") {
            if (ringing == null) stopSelf()
            return
        }
        ringing?.let { (prevId, prevOccurrence) -> missed(prevId, prevOccurrence) }
        stopSound()

        ringing = id to occurrence
        ringingAt = at
        createChannels()
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, ringNotification(task.optString("title"), id, occurrence),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0,
        )
        playSound()
        vibrate()
        handler.removeCallbacks(timeout)
        handler.postDelayed(timeout, TIMEOUT_MS)
    }

    private fun alarmAttributes() =
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()

    private fun playSound() {
        val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(alarmAttributes())
                setDataSource(this@AlarmService, uri)
                isLooping = true
                prepare()
                start()
            }
        }.getOrNull()
    }

    @Suppress("DEPRECATION")
    private fun vibrate() {
        val vibrator = getSystemService(Vibrator::class.java) ?: return
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 600), 0), alarmAttributes())
    }

    private fun stopSound() {
        player?.runCatching { stop(); release() }
        player = null
        getSystemService(Vibrator::class.java)?.cancel()
    }

    private fun finish() {
        Log.i("XpAlarm", "stop ringing=$ringing")
        handler.removeCallbacks(timeout)
        stopSound()
        ringing = null
        AlarmScheduler.reschedule(this, maxOf(System.currentTimeMillis(), ringingAt + 1))
        sendBroadcast(Intent(STOPPED).setPackage(packageName))
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacks(timeout)
        stopSound()
        ringing = null
        super.onDestroy()
    }

    private fun createChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(RING_CHANNEL, "Çalan alarmlar", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null) // the service plays the sound on the alarm stream itself
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        manager.createNotificationChannel(NotificationChannel(MISSED_CHANNEL, "Kaçırılan alarmlar", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun servicePending(action: String, id: String, occurrence: String, minutes: Int = 0) =
        PendingIntent.getService(
            this, (action + minutes).hashCode(), action(this, action, id, occurrence, minutes),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun ringNotification(title: String, id: String, occurrence: String): Notification {
        val screen = PendingIntent.getActivity(
            this, 0, Intent(this, AlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, RING_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_task)
            .setContentTitle(title)
            .setContentText(AlarmActivity.clock(ringingAt))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(screen)
            .setFullScreenIntent(screen, true) // full screen when locked; a heads-up while the phone is in use
            .addAction(0, "Tamamlandı", servicePending(DONE, id, occurrence))
            .addAction(0, "10 dk ertele", servicePending(SNOOZE, id, occurrence, 10))
            .addAction(0, "1 saat", servicePending(SNOOZE, id, occurrence, 60))
            .addAction(0, "Kapat", servicePending(DISMISS, id, occurrence))
            .build()
    }

    private fun missed(id: String, occurrence: String) {
        Log.i("XpAlarm", "missed task=$id")
        val title = store.task(id)?.optString("title") ?: return
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, MISSED_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_task)
            .setContentTitle("Kaçırıldı: $title")
            .setContentText("$occurrence ${AlarmActivity.clock(ringingAt)}")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(store.code(id) + 1, notification)
    }
}

private const val NOTIFICATION_ID = 42
