import { describe, expect, it, vi } from "vitest";
import { handleRequest, type Env } from "./index";
import { loadState, mutateState } from "./store";
import { MemoryD1 } from "./test-d1";

const BASE_URL = "https://fam.example";

function makeEnv(database = new MemoryD1()): Env & { DB: MemoryD1 } {
  return {
    DB: database,
    ASSETS: {
      fetch: vi.fn(async () => new Response("asset", { status: 200 })),
    },
  };
}

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    },
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("same-origin Worker router", () => {
  it("serves non-API requests through the static asset binding", async () => {
    const env = makeEnv();
    const response = await handleRequest(new Request(`${BASE_URL}/settings`), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("returns JSON 404 and no-store for unknown API routes", async () => {
    const response = await handleRequest(
      new Request(`${BASE_URL}/api/does-not-exist`),
      makeEnv(),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await responseJson(response)).toEqual({ error: "Нет такого API-метода" });

    const unknownMutation = await handleRequest(
      new Request(`${BASE_URL}/api/does-not-exist`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      }),
      makeEnv(),
    );
    expect(unknownMutation.status).toBe(404);
  });

  it("rejects a mismatched Origin before touching storage", async () => {
    const env = makeEnv();
    const response = await handleRequest(
      new Request(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ title: "Не создавать" }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    expect(env.DB.queries).toHaveLength(0);
    expect(await responseJson(response)).toEqual({
      error: "Запрос с другого источника запрещён",
    });
  });

  it("requires JSON for body mutations and caps requests at 16 KB", async () => {
    const env = makeEnv();
    const wrongType = await handleRequest(
      new Request(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      }),
      env,
    );
    expect(wrongType.status).toBe(415);

    const tooLarge = await handleRequest(
      new Request(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(16 * 1024 + 1),
        },
        body: "{}",
      }),
      env,
    );
    expect(tooLarge.status).toBe(413);

    const streamedTooLarge = await handleRequest(
      new Request(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x".repeat(16 * 1024) }),
      }),
      env,
    );
    expect(streamedTooLarge.status).toBe(413);
  });

  it("keeps the old stream endpoint harmless for the polling client", async () => {
    const response = await handleRequest(
      new Request(`${BASE_URL}/api/stream`),
      makeEnv(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("creates a task and exposes it through the state contract", async () => {
    const env = makeEnv();
    const createdResponse = await handleRequest(
      jsonRequest("/api/tasks", "POST", { title: "Забронировать отпуск", hours: 2 }),
      env,
    );
    expect(createdResponse.status).toBe(200);
    const created = await responseJson(createdResponse);

    const stateResponse = await handleRequest(new Request(`${BASE_URL}/api/state`), env);
    expect(stateResponse.status).toBe(200);
    const state = await responseJson(stateResponse);
    expect(state.server_now).toEqual(expect.any(Number));
    expect(state.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, title: "Забронировать отпуск" }),
      ]),
    );
  });

  it("preserves the remaining CRUD contracts used by api.js", async () => {
    const env = makeEnv();

    const shelfCreated = await handleRequest(
      jsonRequest("/api/shelf", "POST", {
        title: "Полить цветы",
        emoji: "🪴",
        base_points: 12,
        hours: 8,
        repeat: true,
        interval_hours: 24,
      }),
      env,
    );
    expect(shelfCreated.status).toBe(201);
    const shelf = await responseJson(shelfCreated);
    const shelfUpdated = await handleRequest(
      jsonRequest(`/api/shelf/${String(shelf.id)}`, "PUT", {
        title: "Полить все цветы",
        hours: 8,
      }),
      env,
    );
    expect(shelfUpdated.status).toBe(200);
    const shelfDeleted = await handleRequest(
      new Request(`${BASE_URL}/api/shelf/${String(shelf.id)}`, {
        method: "DELETE",
        headers: { Origin: BASE_URL },
      }),
      env,
    );
    expect(await responseJson(shelfDeleted)).toEqual({ ok: true });

    const dateCreated = await handleRequest(
      jsonRequest("/api/memorable-dates", "POST", {
        title: "День встречи",
        date: "2020-05-10",
        kind: "meeting",
      }),
      env,
    );
    expect(dateCreated.status).toBe(201);
    const memorableDate = await responseJson(dateCreated);
    const dateUpdated = await handleRequest(
      jsonRequest(`/api/memorable-dates/${String(memorableDate.id)}`, "PUT", {
        title: "Наша встреча",
        date: "2020-05-10",
        kind: "anniversary",
      }),
      env,
    );
    expect(dateUpdated.status).toBe(200);
    const dateDeleted = await handleRequest(
      new Request(`${BASE_URL}/api/memorable-dates/${String(memorableDate.id)}`, {
        method: "DELETE",
        headers: { Origin: BASE_URL },
      }),
      env,
    );
    expect(await responseJson(dateDeleted)).toEqual({ ok: true });

    const renamed = await handleRequest(
      jsonRequest("/api/players/p1", "PATCH", { name: "Лиса" }),
      env,
    );
    expect(renamed.status).toBe(200);
    expect((await responseJson(renamed)).players).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "p1", name: "Лиса" })]),
    );

    const taskCreated = await handleRequest(
      jsonRequest("/api/tasks", "POST", { title: "Удалить меня" }),
      env,
    );
    const task = await responseJson(taskCreated);
    const taskDeleted = await handleRequest(
      new Request(`${BASE_URL}/api/tasks/${String(task.id)}`, {
        method: "DELETE",
        headers: { Origin: BASE_URL },
      }),
      env,
    );
    expect(await responseJson(taskDeleted)).toEqual({ ok: true });

    await mutateState(env.DB, (draft) => {
      draft.events.unshift({
        id: "done-event",
        kind: "done",
        text: "Готово",
        at: Date.now(),
        reactions: [],
      });
      return { changed: true, value: null };
    });
    const reacted = await handleRequest(
      jsonRequest("/api/events/done-event/react", "POST", {
        player_id: "p2",
        emoji: "❤️",
      }),
      env,
    );
    expect(reacted.status).toBe(200);
    expect((await responseJson(reacted)).reactions).toEqual([
      { player_id: "p2", emoji: "❤️" },
    ]);
  });

  it("commits a sweep even when the following claim returns a domain error", async () => {
    const env = makeEnv();
    const now = Date.now();
    await mutateState(env.DB, (draft) => {
      draft.tasks.push({
        id: "expired",
        title: "Просроченное дело",
        emoji: "🔥",
        base_points: 10,
        created_at: now - 10_000,
        deadline: now - 1_000,
        status: "open",
        claimed_by: null,
        awarded_points: null,
        finished_at: null,
        repeat_hours: null,
        interval_hours: null,
        fuse_hours: 1,
        appear_at: null,
      });
      return { changed: true, value: null };
    });
    const beforeRevision = (await loadState(env.DB)).revision;

    const response = await handleRequest(
      jsonRequest("/api/tasks/missing/claim", "POST", { player_id: "p1" }),
      env,
    );

    expect(response.status).toBe(404);
    const after = await loadState(env.DB);
    expect(after.revision).toBe(beforeRevision + 1);
    expect(after.state.tasks.find((task) => task.id === "expired")?.status).toBe("burned");
  });

  it("does not commit an unsuccessful claim when sweep changed nothing", async () => {
    const env = makeEnv();
    await handleRequest(new Request(`${BASE_URL}/api/state`), env);
    const before = await loadState(env.DB);

    const response = await handleRequest(
      jsonRequest("/api/tasks/missing/claim", "POST", { player_id: "p1" }),
      env,
    );

    expect(response.status).toBe(404);
    expect((await loadState(env.DB)).revision).toBe(before.revision);
  });

  it("maps persistence failures to 503 without committing the candidate", async () => {
    const env = makeEnv();
    await loadState(env.DB);
    env.DB.failUpdates = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await handleRequest(
        jsonRequest("/api/tasks", "POST", { title: "Не потерять" }),
        env,
      );

      expect(response.status).toBe(503);
      expect(await responseJson(response)).toEqual({
        error: "Не удалось сохранить данные, попробуйте ещё раз",
      });
      expect((await loadState(env.DB)).state.tasks).toHaveLength(0);
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });
});
