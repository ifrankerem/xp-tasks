package com.ifrankerem.taskmanager.alarms

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** The black ringing screen, shown over the lock screen (alarm.html). */
class AlarmActivity : Activity() {
    companion object {
        fun clock(ms: Long): String = SimpleDateFormat("HH:mm", Locale("tr")).format(Date(if (ms > 0) ms else System.currentTimeMillis()))
    }

    private val stopped = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val (id, occurrence) = AlarmService.ringing ?: return finish()
        val task = AlarmStore(this).task(id)
        ContextCompat.registerReceiver(this, stopped, IntentFilter(AlarmService.STOPPED), ContextCompat.RECEIVER_NOT_EXPORTED)

        fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
        fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
            this.text = value
            setTextColor(color)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
            gravity = Gravity.CENTER
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }
        fun button(label: String, fill: Int, textColor: Int, action: String, minutes: Int = 0) = Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(textColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            background = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(fill); setStroke(dp(1), Color.parseColor("#1c1c1c")) }
            minHeight = dp(64)
            setOnClickListener { startService(AlarmService.action(this@AlarmActivity, action, id, occurrence, minutes)) }
        }
        fun row(vararg children: android.view.View) = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            children.forEachIndexed { i, child ->
                addView(child, LinearLayout.LayoutParams(0, dp(64), 1f).apply { if (i > 0) marginStart = dp(12) })
            }
        }

        val gray = Color.parseColor("#9a9a9a")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.BLACK)
            setPadding(dp(24), dp(72), dp(24), dp(32))
            addView(text("⏰ Alarm", 16f, Color.parseColor("#ff9f43")))
            addView(text(clock(System.currentTimeMillis()), 80f, Color.WHITE, bold = true))
            addView(text(task?.optString("title") ?: "", 28f, Color.WHITE, bold = true).apply { setPadding(0, dp(16), 0, dp(8)) })
            addView(text(task?.optString("note") ?: "", 16f, gray).apply { maxLines = 4 })
            addView(android.view.View(context), LinearLayout.LayoutParams(1, 0, 1f))
            val full = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)).apply { topMargin = dp(12) }
            addView(button("Tamamlandı", Color.parseColor("#1f8f4e"), Color.WHITE, AlarmService.DONE), full)
            addView(
                row(
                    button("10 dk ertele", Color.parseColor("#0d0d0d"), Color.parseColor("#ff9f43"), AlarmService.SNOOZE, 10),
                    button("1 saat", Color.parseColor("#0d0d0d"), Color.parseColor("#ff9f43"), AlarmService.SNOOZE, 60),
                ),
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)).apply { topMargin = dp(12) },
            )
            addView(button("Kapat", Color.parseColor("#0d0d0d"), Color.WHITE, AlarmService.DISMISS), full)
        }
        setContentView(root)
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(stopped) }
        super.onDestroy()
    }
}
