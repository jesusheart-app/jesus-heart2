const reminderTimes = Object.freeze([
  { hour: 21, minute: 7 },
  { hour: 9, minute: 17 },
  { hour: 14, minute: 23 },
  { hour: 19, minute: 37 },
  { hour: 10, minute: 41 },
  { hour: 16, minute: 13 },
  { hour: 15, minute: 29 }
]);

const weekdayNumbers = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
});

const koreanDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

export function koreanDateTime(date = new Date()) {
  const parts = Object.fromEntries(
    koreanDateTimeFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdayNumbers[parts.weekday],
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

export function reminderRunState(date = new Date()) {
  const korea = koreanDateTime(date);
  const target = reminderTimes[korea.weekday];
  const currentMinutes = korea.hour * 60 + korea.minute;
  const targetMinutes = target.hour * 60 + target.minute;

  if (currentMinutes < targetMinutes) {
    return { ...korea, shouldSend: false, reason: "before-reminder-time" };
  }

  if (korea.weekday === 5 && currentMinutes >= 20 * 60 && currentMinutes < 22 * 60) {
    return { ...korea, shouldSend: false, reason: "friday-quiet-hours" };
  }

  return { ...korea, shouldSend: true, reason: "due" };
}
