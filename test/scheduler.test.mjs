import test from "node:test";
import assert from "node:assert/strict";
import { dueScheduledJob, quietEndUtc, shouldRunScheduledJob } from "../src/v5/scheduler.js";

test("daily schedule catches up after the configured time", () => {
  const due = dueScheduledJob({ category_key: "morning_report", mode: "daily", schedule_time: "07:30" }, new Date("2026-10-26T05:47:00Z"));
  assert.equal(due.localKey, "2026-10-26T07:30");
  assert.equal(shouldRunScheduledJob(due, "2026-10-25 04:30:00"), true);
  assert.equal(shouldRunScheduledJob(due, due.dueAt), false);
});

test("daily schedule does not run before its local due time", () => {
  const job = dueScheduledJob({ category_key: "evening_report", mode: "daily", schedule_time: "21:30" }, new Date("2026-10-26T17:00:00Z"));
  assert.equal(shouldRunScheduledJob(job, null), false);
});

test("weekly and monthly schedules use the most recent local due date", () => {
  const weekly = dueScheduledJob({ category_key: "weekly_digest", mode: "weekly", weekday: 1, schedule_time: "08:00" }, new Date("2026-10-27T10:00:00Z"));
  const monthly = dueScheduledJob({ category_key: "monthly_digest", mode: "monthly", monthday: 1, schedule_time: "08:00" }, new Date("2026-10-26T10:00:00Z"));
  assert.match(weekly.localKey, /^2026-10-26T08:00$/);
  assert.match(monthly.localKey, /^2026-10-01T08:00$/);
});

test("schedule conversion handles a Kyiv daylight-saving transition without duplicate local keys", () => {
  const before = dueScheduledJob({ category_key: "morning_report", mode: "daily", schedule_time: "07:30" }, new Date("2026-10-25T05:45:00Z")),
    after = dueScheduledJob({ category_key: "morning_report", mode: "daily", schedule_time: "07:30" }, new Date("2026-10-25T07:00:00Z"));
  assert.equal(before.localKey, after.localKey);
});

test("quiet-hour delivery targets the configured Kyiv end through midnight and DST", () => {
  const channel={quiet_start:"23:00",quiet_end:"07:00"};
  assert.equal(quietEndUtc(channel,{date:"2026-10-26",hour:23,minute:30}),"2026-10-27 05:00:00");
  assert.equal(quietEndUtc(channel,{date:"2026-10-26",hour:2,minute:0}),"2026-10-26 05:00:00");
});
