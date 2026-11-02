import test from "node:test";
import assert from "node:assert/strict";
import { ask } from "../src/ai.js";

function mockEnvironment({ outdoorReading = null, aiReplies = [] } = {}) {
  const calls = { ai: 0, queries: [], writes: [] };
  return {
    calls,
    env: {
      AI: {
        async run() {
          return { response: aiReplies[calls.ai++] || "" };
        },
      },
      DB: {
        prepare(sql) {
          const statement = {
            params: [],
            bind(...params) {
              this.params = params;
              return this;
            },
            async first() {
              calls.queries.push({ sql, params: this.params });
              return sql.includes("FROM devices d LEFT JOIN climate_logs")
                ? outdoorReading
                : null;
            },
            async all() {
              calls.queries.push({ sql, params: this.params });
              if (sql.includes("ai_chat_history")) return { results: [] };
              return { results: [{ reading_count: 2 }] };
            },
          };
          return statement;
        },
        async batch(statements) {
          calls.writes.push(statements);
        },
      },
    },
  };
}

test("last outdoor sensor question is answered directly from D1 with freshness", async () => {
  const { env, calls } = mockEnvironment({
    outdoorReading: {
      device_name: "Outdoor Sensor",
      temperature: 8.4,
      humidity: 71,
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    },
  });

  const answer = await ask(env, "42", "Коли останній показник зовнішнього датчика?");

  assert.match(answer, /Outdoor Sensor/);
  assert.match(answer, /8,4 °C/);
  assert.match(answer, /вологість 71%/);
  assert.match(answer, /Час за Києвом/);
  assert.equal(calls.ai, 0);
  assert.equal(calls.writes.length, 1);
});

test("a database answer rejected by the verifier is not shown to the user", async () => {
  const { env, calls } = mockEnvironment({
    aiReplies: [
      '{"mode":"sql","sql":"SELECT COUNT(*) AS reading_count FROM climate_logs","params":[]}',
      "У базі є 9 вимірів.",
      '{"supported":false}',
    ],
  });

  const answer = await ask(env, "42", "Скільки є вимірів?");

  assert.match(answer, /Не вдалося підтвердити відповідь/);
  assert.doesNotMatch(answer, /9 вимірів/);
  assert.equal(calls.ai, 3);
  assert.equal(calls.writes.length, 1);
});

test("a database answer supported by the verifier is returned", async () => {
  const { env, calls } = mockEnvironment({
    aiReplies: [
      '{"mode":"sql","sql":"SELECT COUNT(*) AS reading_count FROM climate_logs","params":[]}',
      "У базі є 2 виміри.",
      '{"supported":true}',
    ],
  });

  const answer = await ask(env, "42", "Скільки є вимірів?");

  assert.equal(answer, "У базі є 2 виміри.");
  assert.equal(calls.ai, 3);
  assert.equal(calls.writes.length, 1);
});
