package com.ifrankerem.taskmanager;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.ifrankerem.taskmanager.alarms.AlarmActivity;
import com.ifrankerem.taskmanager.alarms.AlarmService;
import com.ifrankerem.taskmanager.alarms.XpAlarmsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(XpAlarmsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        // If the alarm notification could not show (permission off, full screen
        // refused), opening the app still gives a way to stop the ringing.
        if (AlarmService.Companion.getRinging() != null) startActivity(new Intent(this, AlarmActivity.class));
    }
}
