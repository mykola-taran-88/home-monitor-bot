const dateParts = (date, timezone) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
const localClock = (date, timezone) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
const shiftDate = (isoDate, days) => {
  const [y, m, d] = isoDate.split("-").map(Number), x = new Date(Date.UTC(y, m - 1, d + days));
  return x.toISOString().slice(0, 10);
};
export function localWallToUtc(date, time, timezone = "Europe/Kyiv") {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number),
    wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 5; i++) {
    const parts = dateParts(new Date(guess), timezone), clock = localClock(new Date(guess), timezone),
      [ch, cm] = clock.split(":").map(Number), represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day, ch, cm);
    const delta = wall - represented;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess);
}
export function quietEndUtc(channel, localNow, timezone = "Europe/Kyiv") {
  const [endHour,endMinute]=channel.quiet_end.split(":").map(Number), end=endHour*60+endMinute,
    current=localNow.hour*60+localNow.minute, wraps=channel.quiet_start>=channel.quiet_end,
    endToday=!wraps||current<end, [y,m,d]=localNow.date.split("-").map(Number),
    date=new Date(Date.UTC(y,m-1,d+(endToday?0:1))).toISOString().slice(0,10);
  return localWallToUtc(date,channel.quiet_end,timezone).toISOString().slice(0,19).replace("T"," ");
}
const compareSqlDate = (value) => Date.parse(`${String(value || "").replace(" ", "T")}Z`) || 0;

export function dueScheduledJob(row, now = new Date(), timezone = "Europe/Kyiv") {
  if (!row?.schedule_time || !/^\d{2}:\d{2}$/.test(row.schedule_time)) return null;
  const today = dateParts(now, timezone), todayIso = `${today.year}-${today.month}-${today.day}`,
    parts = row.schedule_time.split(":"), weekday = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now) === "Sun" ? 0 : new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now) === "Mon" ? 1 : new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now) === "Tue" ? 2 : new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now) === "Wed" ? 3 : new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now) === "Thu" ? 4 : new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now) === "Fri" ? 5 : 6),
    day = Number(today.day), monthDay = Number(row.monthday || 1);
  let dueDate = todayIso;
  if (row.mode === "weekly") {
    const desired = Number(row.weekday ?? 1), back = (weekday - desired + 7) % 7;
    dueDate = shiftDate(todayIso, -back);
  } else if (row.mode === "monthly") {
    const [y, m] = todayIso.split("-").map(Number), target = Math.min(monthDay, new Date(Date.UTC(y, m, 0)).getUTCDate());
    dueDate = `${y}-${String(m).padStart(2, "0")}-${String(target).padStart(2, "0")}`;
    if (day < target) {
      const prev = new Date(Date.UTC(y, m - 2, 1)), py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1,
        pd = Math.min(monthDay, new Date(Date.UTC(py, pm, 0)).getUTCDate());
      dueDate = `${py}-${String(pm).padStart(2, "0")}-${String(pd).padStart(2, "0")}`;
    }
  }
  let due = localWallToUtc(dueDate, `${parts[0]}:${parts[1]}`, timezone);
  if (due.getTime() > now.getTime()) {
    if (row.mode === "weekly") dueDate = shiftDate(dueDate, -7);
    else if (row.mode === "monthly") {
      const [y, m] = dueDate.split("-").map(Number), prev = new Date(Date.UTC(y, m - 2, 1)), py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1,
        pd = Math.min(monthDay, new Date(Date.UTC(py, pm, 0)).getUTCDate());
      dueDate = `${py}-${String(pm).padStart(2, "0")}-${String(pd).padStart(2, "0")}`;
    } else dueDate = shiftDate(dueDate, -1);
    due = localWallToUtc(dueDate, row.schedule_time, timezone);
  }
  if (due.getTime() > now.getTime()) return null;
  const dueAt = due.toISOString().slice(0, 19).replace("T", " "),
    next = new Date(due.getTime() + 60_000),
    local = dateParts(due, timezone),
    localKey = `${local.year}-${local.month}-${local.day}T${localClock(due, timezone)}`;
  return { dueAt, localKey, jobKey: `${row.category_key}:${localKey}`, currentLocalDate: todayIso, stale: now.getTime() - due.getTime() > (row.mode === "weekly" ? 7 : row.mode === "monthly" ? 32 : 1) * 86400000, nextRunAt: next.toISOString() };
}

export function shouldRunScheduledJob(job, lastSuccessAt) {
  if (!job) return false;
  if (!lastSuccessAt) return job.localKey.slice(0, 10) === job.currentLocalDate;
  return compareSqlDate(lastSuccessAt) < compareSqlDate(job.dueAt);
}

export function severityRank(severity) {
  return ({ critical: 4, high: 3, warning: 3, medium: 2, info: 1 })[severity] || 0;
}
