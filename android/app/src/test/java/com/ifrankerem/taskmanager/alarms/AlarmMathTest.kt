package com.ifrankerem.taskmanager.alarms

import java.io.File
import java.time.Instant
import java.time.ZoneId
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class AlarmMathTest {
    @Test fun sharedVectors() {
        val vectors = JSONObject(File("../../test-vectors/alarms.json").readText())
        val zone = ZoneId.of(vectors.getString("zone"))
        val cases = vectors.getJSONArray("alarms")
        for (i in 0 until cases.length()) {
            val row = cases.getJSONObject(i)
            val expected = if (row.isNull("next")) null else Instant.parse(row.getString("next")).toEpochMilli()
            assertEquals(row.getString("name"), expected, AlarmMath.next(row.getJSONObject("task"), Instant.parse(row.getString("now")).toEpochMilli(), zone)?.second)
        }
    }
}
