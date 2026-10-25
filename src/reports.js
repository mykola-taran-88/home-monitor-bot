import { ANALYTICS, n, fmt, age, comfort, kyivDateTime } from "./constants.js";
import { latest, score, now } from "./database.js";
import { tg, send } from "./telegram.js";

export function kyivDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function monthStart() {
  return kyivDate().slice(0, 7) + "-01 00:00:00";
}
export function weatherName(c) {
  return (
    {
      0: "ясно",
      1: "переважно ясно",
      2: "мінлива хмарність",
      3: "хмарно",
      45: "туман",
      48: "туман",
      51: "мряка",
      53: "мряка",
      55: "сильна мряка",
      61: "невеликий дощ",
      63: "дощ",
      65: "сильний дощ",
      71: "слабкий сніг",
      73: "сніг",
      75: "сильний сніг",
      80: "зливи",
      81: "зливи",
      82: "сильні зливи",
      95: "гроза",
      96: "гроза з градом",
      99: "сильна гроза",
    }[n(c)] || "невідомі умови"
  );
}
export function weatherEmoji(c) {
  c = n(c);
  if (c === 0) return "☀️";
  if (c <= 3) return "⛅";
  if (c === 45 || c === 48) return "🌫";
  if (c <= 67) return "🌧";
  if (c <= 77) return "❄️";
  if (c <= 82) return "🌦";
  return "⛈";
}
export async function periodEnergy(e, start) {
  const r = (
    await e.DB.prepare(
      "SELECT energy_total,tariff_zone,cost_per_kwh,created_at FROM power_logs WHERE created_at>=? ORDER BY id",
    )
      .bind(start)
      .all()
  ).results;
  let day = 0,
    night = 0,
    cost = 0;
  for (let i = 1; i < r.length; i++) {
    const d = n(r[i].energy_total) - n(r[i - 1].energy_total);
    if (!isFinite(d) || d < 0 || d > 100) continue;
    if (r[i].tariff_zone === "night") night += d;
    else day += d;
    cost += d * n(r[i].cost_per_kwh);
  }
  return { total: day + night, day, night, cost, samples: r.length };
}
export async function energyOverview(e) {
  const p = now(),
    today = await periodEnergy(e, `${p.date} 00:00:00`),
    week = await periodEnergy(e, `${kyivDate(-6)} 00:00:00`),
    month = await periodEnergy(e, monthStart()),
    current = await e.DB.prepare(
      "SELECT * FROM power_logs ORDER BY id DESC LIMIT 1",
    ).first(),
    peak = await e.DB.prepare(
      "SELECT power,voltage,created_at FROM power_logs WHERE created_at>=? ORDER BY power DESC LIMIT 1",
    )
      .bind(`${p.date} 00:00:00`)
      .first(),
    days = Math.max(1, n(p.day, 1)),
    daysInMonth = new Date(p.year, p.month, 0).getDate(),
    forecastKwh = (month.total / days) * daysInMonth,
    forecastCost = (month.cost / days) * daysInMonth;
  return { current, today, week, month, peak, forecastKwh, forecastCost };
}
export async function energyText(e) {
  const x = await energyOverview(e);
  return [
    "⚡ ЕНЕРГІЯ",
    `Поточна потужність: ${fmt(x.current?.power, 0)} Вт`,
    `Напруга: ${fmt(x.current?.voltage, 1)} В`,
    `Струм: ${fmt(x.current?.current, 2)} А`,
    `Частота: ${fmt(x.current?.frequency, 1)} Гц`,
    "",
    `📅 Сьогодні: ${fmt(x.today.total, 3)} кВт·год · ${fmt(x.today.cost, 2)} грн`,
    `📆 7 днів: ${fmt(x.week.total, 3)} кВт·год · ${fmt(x.week.cost, 2)} грн`,
    `🗓 Цей місяць: ${fmt(x.month.total, 3)} кВт·год · ${fmt(x.month.cost, 2)} грн`,
    `🌙 День / ніч: ${fmt(x.month.day, 3)} / ${fmt(x.month.night, 3)} кВт·год`,
    "",
    `📈 Пік сьогодні: ${fmt(x.peak?.power, 0)} Вт${x.peak?.created_at ? ` о ${String(x.peak.created_at).slice(11, 16)}` : ""}`,
    `🔮 Прогноз місяця: ${fmt(x.forecastKwh, 1)} кВт·год · ${fmt(x.forecastCost, 0)} грн`,
  ].join("\n");
}
export function forecastDayLabel(date) {
  const today = kyivDate(),
    tomorrow = kyivDate(1);
  if (date === today) return "Сьогодні";
  if (date === tomorrow) return "Завтра";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(date + "T12:00:00Z"));
}
export async function weatherTextRich(e) {
  const x = await latest(e),
    rows = (
      await e.DB.prepare(
        "SELECT * FROM weather_hourly WHERE forecast_time>=datetime('now') ORDER BY forecast_time ASC LIMIT 48",
      ).all()
    ).results;
  const sorted = [...rows].sort((a, b) =>
      String(a.forecast_time).localeCompare(String(b.forecast_time)),
    ),
    sampled = sorted.filter((_, i) => i % 3 === 0).slice(0, 8),
    groups = {};
  for (const h of sampled) {
    const raw = String(h.forecast_time || ""),
      date = raw.slice(0, 10);
    (groups[date] ??= []).push(h);
  }
  const hourly = [];
  for (const [date, items] of Object.entries(groups)) {
    hourly.push(`📅 ${forecastDayLabel(date)}`);
    for (const h of items)
      hourly.push(
        `${String(h.forecast_time).slice(11, 16)} ${weatherEmoji(h.weather_code)} ${fmt(h.temperature)} °C · дощ ${fmt(h.precipitation_probability, 0)}%`,
      );
    hourly.push("");
  }
  const daily = x.daily.slice(0, 3);
  return [
    "🌦 ПОГОДА",
    `${weatherEmoji(x.weather?.weather_code)} Зараз: ${fmt(x.weather?.temperature)} °C · ${fmt(x.weather?.humidity, 0)}%`,
    `Умови: ${weatherName(x.weather?.weather_code)}`,
    `Вітер: ${fmt(x.weather?.wind_speed, 1)} км/год · Тиск: ${fmt(x.weather?.pressure, 0)} гПа`,
    "",
    "📅 Прогноз на 3 дні:",
    ...daily.map(
      (d) =>
        `${weatherEmoji(d.weather_code)} ${forecastDayLabel(String(d.forecast_date).slice(0, 10))}: ${fmt(d.temp_min)}…${fmt(d.temp_max)} °C · дощ ${fmt(d.precipitation_probability, 0)}%`,
    ),
    "",
    "🕒 Найближчі 24 години (крок 3 год):",
    ...hourly,
  ]
    .join("\n")
    .trim();
}
export async function weatherForecast48hText(e) {
  const from = kyivDateTime(), to = kyivDateTime(48 * 60);
  const rows = (
    await e.DB.prepare(
      "SELECT * FROM weather_hourly WHERE forecast_time>=? AND forecast_time<=? ORDER BY forecast_time ASC",
    ).bind(from, to).all()
  ).results;
  if (!rows.length) return "🌦 ПРОГНОЗ ПОГОДИ НА 48 ГОДИН\nНемає актуальних погодинних даних.";
  const groups = {};
  for (const h of rows) {
    const date = String(h.forecast_time || "").slice(0, 10);
    (groups[date] ??= []).push(h);
  }
  const lines = ["🌦 ПРОГНОЗ ПОГОДИ НА НАСТУПНІ 48 ГОДИН", "Крок прогнозу — 3 години."];
  for (const [date, items] of Object.entries(groups)) {
    lines.push("", `📅 ${forecastDayLabel(date)}`);
    for (const h of items)
      lines.push(
        `${String(h.forecast_time).slice(11, 16)} ${weatherEmoji(h.weather_code)} ${weatherName(h.weather_code)} · ${fmt(h.temperature)} °C · опади ${fmt(h.precipitation_probability, 0)}% · вітер ${fmt(h.wind_speed, 0)} км/год`,
      );
  }
  return lines.join("\n");
}
export async function scoreText(e) {
  const x = await latest(e),
    s = score(x),
    indoor = x.zones.filter((z) => !z.is_outdoor && z.temperature != null),
    offline = x.zones.filter(
      (z) => age(z.created_at) > 15 || age(z.created_at) == null,
    ),
    critical = x.alerts.filter((a) => a.severity === "critical"),
    roomScores = indoor
      .map((z) => ({
        name: z.device_name || z.device_id,
        v: comfort(z.temperature, z.humidity),
      }))
      .sort((a, b) => b.v - a.v),
    reasons = [];
  if (s.comfort >= 90)
    reasons.push("✅ Клімат у кімнатах близький до оптимального");
  else reasons.push(`⚠️ Комфорт знижений: середня оцінка ${s.comfort}/100`);
  if (!offline.length) reasons.push("✅ Усі датчики передають свіжі дані");
  else reasons.push(`⚠️ Несвіжі/offline датчики: ${offline.length}`);
  if (critical.length) reasons.push(`🔴 Критичні алерти: ${critical.length}`);
  else reasons.push("✅ Критичних алертів немає");
  if (x.alerts.length)
    reasons.push(`ℹ️ Усього активних алертів: ${x.alerts.length}`);
  return [
    "📊 HOME SCORE",
    `Загальна оцінка: ${s.overall}/100`,
    `Клімат: ${s.comfort}/100`,
    `Стан системи: ${s.health}/100`,
    "",
    "Обґрунтування:",
    ...reasons,
    "",
    roomScores.length
      ? `🏆 Найкраща кімната: ${roomScores[0].name} · ${roomScores[0].v}/100`
      : "",
    roomScores.length > 1
      ? `📉 Потребує уваги: ${roomScores.at(-1).name} · ${roomScores.at(-1).v}/100`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
export async function homeSummaryRich(e) {
  const x = await latest(e),
    en = await energyOverview(e),
    s = score(x),
    today = x.daily[0],
    tomorrow = x.daily[1],
    z = x.zones.filter((a) => !a.is_outdoor && a.temperature != null),
    avg = z.length
      ? z.reduce((q, a) => q + n(a.temperature), 0) / z.length
      : null;
  return [
    "🏠 ЗВЕДЕННЯ ДОМУ",
    `📊 Home Score: ${s.overall}/100`,
    `🌡 Вдома: ${fmt(avg)} °C`,
    `⚡ Зараз: ${fmt(x.power?.power, 0)} Вт · ${fmt(x.power?.voltage, 1)} В`,
    `📅 Сьогодні: ${fmt(en.today.total, 3)} кВт·год · ${fmt(en.today.cost, 2)} грн`,
    `🗓 Місяць: ${fmt(en.month.total, 3)} кВт·год · ${fmt(en.month.cost, 2)} грн`,
    "",
    `🌦 Сьогодні: ${today ? `${fmt(today.temp_min)}…${fmt(today.temp_max)} °C · дощ ${fmt(today.precipitation_probability, 0)}%` : "—"}`,
    `🌦 Завтра: ${tomorrow ? `${fmt(tomorrow.temp_min)}…${fmt(tomorrow.temp_max)} °C · дощ ${fmt(tomorrow.precipitation_probability, 0)}%` : "—"}`,
    `🚨 Активні алерти: ${x.alerts.length}`,
    x.recs[0]
      ? `💡 ${x.recs[0].title}: ${x.recs[0].message}`
      : "✅ Термінових рекомендацій немає",
  ].join("\n");
}
export async function analyticsText(e, days) {
  const start = `${kyivDate(-(days - 1))} 00:00:00`,
    en = await periodEnergy(e, start),
    r = await e.DB.prepare(
      "SELECT ROUND(AVG(power),1) avg_power,ROUND(MAX(power),1) peak_power,ROUND(AVG(voltage),1) avg_voltage,ROUND(MIN(voltage),1) min_voltage,ROUND(MAX(voltage),1) max_voltage FROM power_logs WHERE created_at>=?",
    )
      .bind(start)
      .first(),
    t = await e.DB.prepare(
      "SELECT ROUND(AVG(temperature),1) avg_temp,ROUND(MIN(temperature),1) min_temp,ROUND(MAX(temperature),1) max_temp FROM climate_logs WHERE created_at>=?",
    )
      .bind(start)
      .first();
  return [
    `📊 АНАЛІТИКА · ${days === 1 ? "СЬОГОДНІ" : days + " ДНІВ"}`,
    `⚡ Споживання: ${fmt(en.total, 3)} кВт·год`,
    `💰 Вартість: ${fmt(en.cost, 2)} грн`,
    `📅 Середньодобове: ${fmt(en.total / Math.max(1, days), 3)} кВт·год`,
    `📈 Середня / пікова потужність: ${fmt(r?.avg_power, 0)} / ${fmt(r?.peak_power, 0)} Вт`,
    `🔌 Напруга min / avg / max: ${fmt(r?.min_voltage, 1)} / ${fmt(r?.avg_voltage, 1)} / ${fmt(r?.max_voltage, 1)} В`,
    `🌡 Температура min / avg / max: ${fmt(t?.min_temp)} / ${fmt(t?.avg_temp)} / ${fmt(t?.max_temp)} °C`,
  ].join("\n");
}
export function chartUrl(config) {
  return `https://quickchart.io/chart?width=900&height=500&backgroundColor=white&version=4&c=${encodeURIComponent(JSON.stringify(config))}`;
}
export async function chartConfigs(e, days) {
  const start = `${kyivDate(-(days - 1))} 00:00:00`;
  const power = (
    await e.DB.prepare(
      "SELECT substr(created_at,1,10) d,ROUND(AVG(power),0) avg_power,ROUND(MAX(power),0) peak_power,ROUND(AVG(voltage),1) avg_v,ROUND(MIN(voltage),1) min_v,ROUND(MAX(voltage),1) max_v,MIN(energy_total) e0,MAX(energy_total) e1,ROUND(AVG(cost_per_kwh),3) tariff FROM power_logs WHERE created_at>=? GROUP BY substr(created_at,1,10) ORDER BY d",
    )
      .bind(start)
      .all()
  ).results;
  const climate = (
    await e.DB.prepare(
      "SELECT substr(c.created_at,1,10) d,c.device_id,COALESCE(d.device_name,c.device_id) name,ROUND(AVG(c.temperature),1) temp FROM climate_logs c LEFT JOIN devices d ON d.device_id=c.device_id WHERE c.created_at>=? GROUP BY substr(c.created_at,1,10),c.device_id ORDER BY d",
    )
      .bind(start)
      .all()
  ).results;
  if (!power.length && !climate.length) return [];
  const labels = [
    ...new Set([...power.map((x) => x.d), ...climate.map((x) => x.d)]),
  ].sort();
  const byDay = Object.fromEntries(power.map((x) => [x.d, x]));
  const kwh = labels.map((d) => {
    const x = byDay[d];
    return x ? Math.max(0, n(x.e1) - n(x.e0)) : null;
  });
  const cost = labels.map((d, i) => {
    const x = byDay[d];
    return x == null || kwh[i] == null
      ? null
      : +(kwh[i] * n(x.tariff)).toFixed(2);
  });
  const temps = {};
  for (const x of climate) (temps[x.name] ??= []).push({ d: x.d, v: x.temp });
  const dayLabels = labels.map((x) => x.slice(5));
  return [
    {
      caption: `⚡ Споживання за ${days} дн.`,
      config: {
        type: "bar",
        data: {
          labels: dayLabels,
          datasets: [
            { label: "кВт·год", data: kwh, backgroundColor: "#35b9c7" },
          ],
        },
        options: {
          plugins: {
            title: { display: true, text: "Споживання електроенергії" },
          },
        },
      },
    },
    {
      caption: `💰 Вартість за ${days} дн.`,
      config: {
        type: "bar",
        data: {
          labels: dayLabels,
          datasets: [{ label: "грн", data: cost, backgroundColor: "#f6b73c" }],
        },
        options: {
          plugins: {
            title: { display: true, text: "Вартість електроенергії" },
          },
        },
      },
    },
    {
      caption: `🔌 Напруга за ${days} дн.`,
      config: {
        type: "line",
        data: {
          labels: dayLabels,
          datasets: [
            {
              label: "Min V",
              data: labels.map((d) => byDay[d]?.min_v ?? null),
              borderColor: "#ff647c",
              spanGaps: true,
            },
            {
              label: "Avg V",
              data: labels.map((d) => byDay[d]?.avg_v ?? null),
              borderColor: "#35b9c7",
              spanGaps: true,
            },
            {
              label: "Max V",
              data: labels.map((d) => byDay[d]?.max_v ?? null),
              borderColor: "#7656d9",
              spanGaps: true,
            },
          ],
        },
        options: {
          plugins: {
            title: { display: true, text: "Напруга min / avg / max" },
          },
        },
      },
    },
    {
      caption: `🌡 Температура за ${days} дн.`,
      config: {
        type: "line",
        data: {
          labels: dayLabels,
          datasets: Object.entries(temps)
            .slice(0, 6)
            .map(([name, arr], i) => ({
              label: name,
              data: labels.map((d) => arr.find((x) => x.d === d)?.v ?? null),
              borderColor: [
                "#e74c3c",
                "#3498db",
                "#2ecc71",
                "#9b59b6",
                "#f39c12",
                "#34495e",
              ][i],
              spanGaps: true,
            })),
        },
        options: {
          plugins: {
            title: { display: true, text: "Температура по кімнатах" },
          },
        },
      },
    },
  ];
}
export async function chart(e, id, days) {
  await send(e, id, await analyticsText(e, days), ANALYTICS);
  return sendChartPack(e, id, days);
}
export async function sendChartPack(e, id, days) {
  const cs = await chartConfigs(e, days);
  if (!cs.length) return send(e, id, "Немає даних для графіків.");
  for (const x of cs)
    try {
      await tg(e, "sendPhoto", {
        chat_id: id,
        photo: chartUrl(x.config),
        caption: x.caption,
      });
    } catch (err) {
      console.error("CHART_SEND", err);
    }
}
