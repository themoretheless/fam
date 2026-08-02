import {
  ApiError,
  claimTask,
  createMemorableDate,
  createShelfItem,
  createTask,
  deleteMemorableDate,
  deleteShelfItem,
  deleteTask,
  reactEvent,
  renamePlayer,
  stateResponse,
  sweep,
  updateMemorableDate,
  updateShelfItem,
} from "./domain";
import {
  type D1Database,
  mutateState,
  StateStoreError,
  type StoredState,
} from "./store";

const MAX_JSON_BYTES = 16 * 1024;

export interface Env {
  DB: D1Database;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function apiHeaders(json = true): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (json) headers.set("Content-Type", "application/json; charset=utf-8");
  return headers;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: apiHeaders(),
  });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: apiHeaders(false) });
}

function apiErrorStatus(error: ApiError): number {
  const candidate = error as ApiError & { statusCode?: unknown };
  const status = Number(candidate.status ?? candidate.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 422;
}

function decodeId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "Некорректный идентификатор");
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Ожидался Content-Type application/json");
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
      throw new HttpError(413, "JSON-запрос слишком большой");
    }
  }

  if (!request.body) throw new HttpError(400, "Пустой JSON-запрос");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "JSON-запрос слишком большой");
    }
    chunks.push(value);
  }
  if (total === 0) throw new HttpError(400, "Пустой JSON-запрос");

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Некорректный JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Ожидался JSON-объект");
  }
  return parsed as Record<string, unknown>;
}

async function regularMutation<T>(
  env: Env,
  reducer: (draft: StoredState) => T,
): Promise<T> {
  const result = await mutateState(env.DB, (draft) => ({
    changed: true,
    value: reducer(draft),
  }));
  return result.value;
}

async function getState(env: Env): Promise<Response> {
  const now = Date.now();
  const transaction = await mutateState(env.DB, (draft) => ({
    changed: Boolean(sweep(draft, now)),
    value: null,
  }));
  return jsonResponse(stateResponse(transaction.state, now));
}

async function claim(
  env: Env,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  type ClaimAttempt =
    | { ok: true; result: ReturnType<typeof claimTask> }
    | { ok: false; error: ApiError };

  const now = Date.now();
  const transaction = await mutateState<ClaimAttempt>(env.DB, (draft) => {
    const swept = Boolean(sweep(draft, now));
    try {
      return {
        changed: true,
        value: {
          ok: true as const,
          result: claimTask(
            draft,
            id,
            body as unknown as Parameters<typeof claimTask>[2],
            now,
          ),
        },
      };
    } catch (error) {
      if (!(error instanceof ApiError) || !swept) throw error;
      return {
        changed: true,
        value: { ok: false as const, error },
      };
    }
  });

  if (!transaction.value.ok) throw transaction.value.error;
  return jsonResponse(transaction.value.result);
}

async function routeApi(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (path === "/api/state" && method === "GET") return getState(env);
  if (path === "/api/stream" && method === "GET") return noContent();

  if (path === "/api/tasks" && method === "POST") {
    const body = await readJsonObject(request);
    const now = Date.now();
    const result = await regularMutation(env, (draft) =>
      createTask(draft, body as unknown as Parameters<typeof createTask>[1], now),
    );
    return jsonResponse(result);
  }

  let match = path.match(/^\/api\/tasks\/([^/]+)\/claim$/);
  if (match && method === "POST") {
    return claim(env, decodeId(match[1]!), await readJsonObject(request));
  }

  match = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (match && method === "DELETE") {
    const id = decodeId(match[1]!);
    const result = await regularMutation(env, (draft) =>
      deleteTask(draft, id),
    );
    return jsonResponse(result ?? { ok: true });
  }

  if (path === "/api/shelf" && method === "POST") {
    const body = await readJsonObject(request);
    const result = await regularMutation(env, (draft) =>
      createShelfItem(
        draft,
        body as unknown as Parameters<typeof createShelfItem>[1],
      ),
    );
    return jsonResponse(result, 201);
  }

  match = path.match(/^\/api\/shelf\/([^/]+)$/);
  if (match && method === "PUT") {
    const id = decodeId(match[1]!);
    const body = await readJsonObject(request);
    const result = await regularMutation(env, (draft) =>
      updateShelfItem(
        draft,
        id,
        body as unknown as Parameters<typeof updateShelfItem>[2],
      ),
    );
    return jsonResponse(result);
  }
  if (match && method === "DELETE") {
    const id = decodeId(match[1]!);
    const result = await regularMutation(env, (draft) =>
      deleteShelfItem(draft, id),
    );
    return jsonResponse(result ?? { ok: true });
  }

  if (path === "/api/memorable-dates" && method === "POST") {
    const body = await readJsonObject(request);
    const result = await regularMutation(env, (draft) =>
      createMemorableDate(
        draft,
        body as unknown as Parameters<typeof createMemorableDate>[1],
      ),
    );
    return jsonResponse(result, 201);
  }

  match = path.match(/^\/api\/memorable-dates\/([^/]+)$/);
  if (match && method === "PUT") {
    const id = decodeId(match[1]!);
    const body = await readJsonObject(request);
    const result = await regularMutation(env, (draft) =>
      updateMemorableDate(
        draft,
        id,
        body as unknown as Parameters<typeof updateMemorableDate>[2],
      ),
    );
    return jsonResponse(result);
  }
  if (match && method === "DELETE") {
    const id = decodeId(match[1]!);
    const result = await regularMutation(env, (draft) =>
      deleteMemorableDate(draft, id),
    );
    return jsonResponse(result ?? { ok: true });
  }

  match = path.match(/^\/api\/players\/([^/]+)$/);
  if (match && method === "PATCH") {
    const id = decodeId(match[1]!);
    const body = await readJsonObject(request);
    const result = await regularMutation(env, (draft) =>
      renamePlayer(
        draft,
        id,
        body as unknown as Parameters<typeof renamePlayer>[2],
      ),
    );
    return jsonResponse(result);
  }

  match = path.match(/^\/api\/events\/([^/]+)\/react$/);
  if (match && method === "POST") {
    const id = decodeId(match[1]!);
    const body = await readJsonObject(request);
    const result = await regularMutation(env, (draft) =>
      reactEvent(
        draft,
        id,
        body as unknown as Parameters<typeof reactEvent>[2],
      ),
    );
    return jsonResponse(result);
  }

  return errorResponse(404, "Нет такого API-метода");
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!isApiPath(url.pathname)) return env.ASSETS.fetch(request);

  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) {
    return errorResponse(403, "Запрос с другого источника запрещён");
  }

  try {
    return await routeApi(request, env, url);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error.status, error.message);
    if (error instanceof ApiError) {
      return errorResponse(apiErrorStatus(error), error.message);
    }
    if (error instanceof StateStoreError) {
      console.error("state persistence failed", error);
      return errorResponse(503, "Не удалось сохранить данные, попробуйте ещё раз");
    }
    console.error("api request failed", error);
    return errorResponse(500, "Внутренняя ошибка сервера");
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
