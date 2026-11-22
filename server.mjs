import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const AI_TIMEOUT_MS = 300;
const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readValidText(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (typeof payload.text !== "string" || payload.text.trim().length === 0) return null;

  return payload.text;
}

function parseModelOutput(raw) {
  if (typeof raw !== "string") return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!ALLOWED_TOPICS.has(parsed.topic)) return null;
  if (typeof parsed.draft !== "string" || parsed.draft.trim().length === 0) return null;

  return { topic: parsed.topic, draft: parsed.draft.trim() };
}

async function handleTriage(request, response) {
  const text = await readValidText(request);
  if (text === null) {
    return json(response, 400, { status: "invalid_input" });
  }

  try {
    const raw = await classify(text, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
    const result = parseModelOutput(raw);
    if (!result) {
      return json(response, 200, MANUAL_REVIEW);
    }
    return json(response, 200, { status: "ready", ...result });
  } catch {
    return json(response, 200, MANUAL_REVIEW);
  }
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`Server listening on http://127.0.0.1:${port}`);
  });
}