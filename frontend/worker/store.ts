import { defaultDb } from "./domain";

export const STATE_SCHEMA_VERSION = 1;
export const MAX_STATE_BYTES = 1_500_000;
export const MAX_CAS_ATTEMPTS = 5;

const MAX_FINISHED_TASKS = 200;
const MAX_EVENTS = 30;
const MAX_SEASONS = 260;

const CREATE_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS app_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )
`;

const INSERT_DEFAULT_STATE = `
  INSERT OR IGNORE INTO app_state (
    singleton,
    schema_version,
    revision,
    state_json,
    updated_at_ms
  ) VALUES (1, ?, 0, ?, ?)
`;

const SELECT_STATE = `
  SELECT schema_version, revision, state_json
  FROM app_state
  WHERE singleton = 1
`;

const UPDATE_STATE = `
  UPDATE app_state
  SET schema_version = ?,
      revision = revision + 1,
      state_json = ?,
      updated_at_ms = ?
  WHERE singleton = 1 AND revision = ?
`;

export interface D1RunResult {
  success?: boolean;
  changes?: number;
  meta?: {
    changes?: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = D1RunResult>(): Promise<T>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export type StoredState = ReturnType<typeof defaultDb>;

export interface LoadedState {
  revision: number;
  state: StoredState;
}

export interface MutationDecision<T> {
  changed: boolean;
  value: T;
}

export interface MutationResult<T> extends LoadedState {
  committed: boolean;
  value: T;
}

interface StateRow {
  schema_version: number | string;
  revision: number | string;
  state_json: string;
}

export class StateStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StateStoreError";
  }
}

export class StateConflictError extends StateStoreError {
  constructor() {
    super("Не удалось сохранить данные из-за параллельных изменений");
    this.name = "StateConflictError";
  }
}

const schemaPromises = new WeakMap<object, Promise<void>>();

function cloneState(state: StoredState): StoredState {
  if (typeof structuredClone === "function") {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state)) as StoredState;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function timestamp(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactHistory(state: StoredState): void {
  const candidate = state as unknown as Record<string, unknown>;

  if (Array.isArray(candidate.tasks)) {
    const active: unknown[] = [];
    const finished: Array<{ task: unknown; time: number; index: number }> = [];

    candidate.tasks.forEach((task, index) => {
      const record = task as Record<string, unknown>;
      if (record.status === "open" || record.status === "scheduled") {
        active.push(task);
      } else {
        finished.push({
          task,
          time: timestamp(record.finished_at ?? record.deadline ?? record.created_at),
          index,
        });
      }
    });

    finished.sort((left, right) => right.time - left.time || right.index - left.index);
    candidate.tasks = [
      ...active,
      ...finished.slice(0, MAX_FINISHED_TASKS).map(({ task }) => task),
    ];
  }

  if (Array.isArray(candidate.events) && candidate.events.length > MAX_EVENTS) {
    candidate.events = candidate.events.slice(0, MAX_EVENTS);
  }

  if (Array.isArray(candidate.seasons) && candidate.seasons.length > MAX_SEASONS) {
    candidate.seasons = candidate.seasons.slice(-MAX_SEASONS);
  }
}

function serializeState(state: StoredState): { json: string; state: StoredState } {
  let json = JSON.stringify(state);
  if (byteLength(json) <= MAX_STATE_BYTES) return { json, state };

  compactHistory(state);
  json = JSON.stringify(state);
  if (byteLength(json) > MAX_STATE_BYTES) {
    throw new StateStoreError("Состояние приложения превышает допустимый размер");
  }
  return { json, state };
}

function changesOf(result: D1RunResult): number {
  const changes = result.meta?.changes ?? result.changes ?? 0;
  return Number.isFinite(Number(changes)) ? Number(changes) : 0;
}

async function initializeSchema(db: D1Database): Promise<void> {
  await db.prepare(CREATE_STATE_TABLE).run();
  const initial = JSON.stringify(defaultDb());
  if (byteLength(initial) > MAX_STATE_BYTES) {
    throw new StateStoreError("Начальное состояние превышает допустимый размер");
  }
  await db
    .prepare(INSERT_DEFAULT_STATE)
    .bind(STATE_SCHEMA_VERSION, initial, Date.now())
    .run();
}

export async function ensureSchema(db: D1Database): Promise<void> {
  const key = db as object;
  const existing = schemaPromises.get(key);
  if (existing) return existing;

  const pending = initializeSchema(db).catch((error: unknown) => {
    schemaPromises.delete(key);
    throw new StateStoreError("Не удалось подготовить хранилище", {
      cause: error,
    });
  });
  schemaPromises.set(key, pending);
  return pending;
}

async function selectState(db: D1Database): Promise<LoadedState> {
  let row: StateRow | null;
  try {
    row = await db.prepare(SELECT_STATE).first<StateRow>();
  } catch (error) {
    throw new StateStoreError("Не удалось загрузить состояние приложения", {
      cause: error,
    });
  }
  if (!row) throw new StateStoreError("Состояние приложения не найдено");

  const schemaVersion = Number(row.schema_version);
  const revision = Number(row.revision);
  if (schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new StateStoreError("Версия состояния приложения не поддерживается");
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new StateStoreError("Некорректная ревизия состояния приложения");
  }
  if (typeof row.state_json !== "string") {
    throw new StateStoreError("Некорректное состояние приложения");
  }

  try {
    const state = JSON.parse(row.state_json) as StoredState;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("state must be an object");
    }
    return { revision, state };
  } catch (error) {
    throw new StateStoreError("Сохранённое состояние повреждено", {
      cause: error,
    });
  }
}

export async function loadState(db: D1Database): Promise<LoadedState> {
  await ensureSchema(db);
  return selectState(db);
}

export async function mutateState<T>(
  db: D1Database,
  reducer: (draft: StoredState) => MutationDecision<T> | Promise<MutationDecision<T>>,
): Promise<MutationResult<T>> {
  await ensureSchema(db);

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const loaded = await selectState(db);
    const draft = cloneState(loaded.state);
    const decision = await reducer(draft);

    if (!decision.changed) {
      return {
        revision: loaded.revision,
        state: draft,
        committed: false,
        value: decision.value,
      };
    }

    const serialized = serializeState(draft);
    let result: D1RunResult;
    try {
      result = (await db
        .prepare(UPDATE_STATE)
        .bind(
          STATE_SCHEMA_VERSION,
          serialized.json,
          Date.now(),
          loaded.revision,
        )
        .run()) as D1RunResult;
    } catch (error) {
      throw new StateStoreError("Не удалось сохранить состояние приложения", {
        cause: error,
      });
    }

    if (result.success === false) {
      throw new StateStoreError("Не удалось сохранить состояние приложения");
    }
    if (changesOf(result) === 1) {
      return {
        revision: loaded.revision + 1,
        state: serialized.state,
        committed: true,
        value: decision.value,
      };
    }
  }

  throw new StateConflictError();
}
