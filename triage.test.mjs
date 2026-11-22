import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function postTriage(body, raw = false) {
  const res = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

describe("POST /api/triage", () => {
  it("возвращает ready для корректной заявки", async () => {
    const { status, data } = await postTriage({ text: "Подскажите сроки доставки" });
    assert.equal(status, 200);
    assert.equal(data.status, "ready");
    assert.equal(data.topic, "delivery");
    assert.ok(typeof data.draft === "string" && data.draft.trim().length > 0);
  });

  for (const [name, payload, raw] of [
    ["пустая строка", { text: "" }, false],
    ["только пробелы", { text: "   \n\t " }, false],
    ["отсутствует поле text", {}, false],
    ["нестроковый text", { text: 12345 }, false],
    ["битый JSON", "{broken json", true],
  ]) {
    it(`возвращает 400 invalid_input: ${name}`, async () => {
      const { status, data } = await postTriage(payload, raw);
      assert.equal(status, 400);
      assert.deepEqual(data, { status: "invalid_input" });
    });
  }

  for (const tag of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    it(`возвращает 200 manual_review при сбое ${tag}`, async () => {
      const started = Date.now();
      const { status, data } = await postTriage({ text: `Заявка ${tag}` });
      const elapsed = Date.now() - started;

      assert.equal(status, 200);
      assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
      if (tag === "[timeout]") {
        assert.ok(elapsed < 800, `Ожидался таймаут ~300 мс, заняло ${elapsed} мс`);
      }
    });
  }
});