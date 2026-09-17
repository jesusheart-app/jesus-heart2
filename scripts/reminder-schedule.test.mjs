import test from "node:test";
import assert from "node:assert/strict";
import { koreanDateTime, reminderRunState } from "./reminder-schedule.mjs";

test("한국 날짜와 요일을 기준으로 판단한다", () => {
  assert.deepEqual(koreanDateTime(new Date("2026-09-16T10:43:00Z")), {
    dateKey: "2026-09-16",
    weekday: 3,
    hour: 19,
    minute: 43
  });
});

test("요일별 예정 시각 전에는 보내지 않고 이후에는 보낸다", () => {
  assert.equal(
    reminderRunState(new Date("2026-09-16T10:36:00Z")).reason,
    "before-reminder-time"
  );
  assert.equal(
    reminderRunState(new Date("2026-09-16T10:37:00Z")).reason,
    "due"
  );
});

test("금요일 20시부터 22시 전까지는 보내지 않는다", () => {
  assert.equal(
    reminderRunState(new Date("2026-09-18T10:59:00Z")).reason,
    "due"
  );
  assert.equal(
    reminderRunState(new Date("2026-09-18T11:00:00Z")).reason,
    "friday-quiet-hours"
  );
  assert.equal(
    reminderRunState(new Date("2026-09-18T13:00:00Z")).reason,
    "due"
  );
});

test("자정이 지나면 새 한국 날짜를 사용한다", () => {
  const state = reminderRunState(new Date("2026-09-18T15:05:00Z"));
  assert.equal(state.dateKey, "2026-09-19");
  assert.equal(state.reason, "before-reminder-time");
});
