import { defaultDb } from "./domain";
import type {
  Achievement,
  Db,
  FamEvent,
  FamilyShelfItem,
  MemorableDate,
  Player,
  Reaction,
  SeasonResult,
  Task,
} from "./types";

export const STATE_SCHEMA_VERSION = 1;
export const CONTENT_SEED_VERSION = 2;
export const MAX_STATE_BYTES = 1_500_000;
export const MAX_CAS_ATTEMPTS = 5;

export const EXAMPLE_FAMILY_SHELF: readonly FamilyShelfItem[] = [
  {
    id: "example-shelf-dinner",
    title: "Пример: приготовить ужин",
    emoji: "🍳",
    base_points: 20,
    hours: 12,
    repeat: false,
    interval_hours: null,
  },
  {
    id: "example-shelf-bedding",
    title: "Пример: сменить постельное бельё",
    emoji: "🛏️",
    base_points: 20,
    hours: 48,
    repeat: true,
    interval_hours: 168,
  },
];

export const EXAMPLE_MEMORABLE_DATES: readonly MemorableDate[] = [
  {
    id: "example-date-meeting",
    title: "Пример: день знакомства",
    date: "2024-02-14",
    kind: "meeting",
  },
  {
    id: "example-date-moving",
    title: "Пример: годовщина переезда",
    date: "2023-09-01",
    kind: "anniversary",
  },
];

const MAX_FINISHED_TASKS = 200;
const MAX_EVENTS = 30;
const MAX_SEASONS = 260;

const CREATE_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS app_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    content_seed_version INTEGER NOT NULL DEFAULT 0
  )
`;

const SELECT_CONTENT_SEED_COLUMN = `
  SELECT COUNT(*) AS count
  FROM pragma_table_info('app_state')
  WHERE name = 'content_seed_version'
`;

const ADD_CONTENT_SEED_COLUMN = `
  ALTER TABLE app_state
  ADD COLUMN content_seed_version INTEGER NOT NULL DEFAULT 0
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
  SELECT schema_version, revision, state_json, content_seed_version
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

const UPDATE_SEEDED_STATE = `
  UPDATE app_state
  SET state_json = ?,
      content_seed_version = ?,
      revision = revision + 1,
      updated_at_ms = ?
  WHERE singleton = 1
    AND revision = ?
    AND content_seed_version = ?
`;

const UPDATE_CONTENT_SEED_MARKER = `
  UPDATE app_state
  SET content_seed_version = ?,
      revision = revision + 1,
      updated_at_ms = ?
  WHERE singleton = 1
    AND revision = ?
    AND content_seed_version = ?
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
  content_seed_version: number | string;
}

interface SelectedState extends LoadedState {
  contentSeedVersion: number;
}

interface ColumnCountRow {
  count: number | string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPlayer(value: unknown): value is Player {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.avatar === "string" &&
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.xp) &&
    isNullableFiniteNumber(value.last_claim_at) &&
    typeof value.comeback_week_key === "string"
  );
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.emoji === "string" &&
    isFiniteNumber(value.base_points) &&
    isFiniteNumber(value.created_at) &&
    isFiniteNumber(value.deadline) &&
    ["open", "done", "burned", "scheduled"].includes(String(value.status)) &&
    isNullableString(value.claimed_by) &&
    isNullableFiniteNumber(value.awarded_points) &&
    isNullableFiniteNumber(value.finished_at) &&
    isNullableFiniteNumber(value.repeat_hours) &&
    isNullableFiniteNumber(value.interval_hours) &&
    isNullableFiniteNumber(value.fuse_hours) &&
    isNullableFiniteNumber(value.appear_at)
  );
}

function isReaction(value: unknown): value is Reaction {
  return (
    isRecord(value) &&
    typeof value.player_id === "string" &&
    typeof value.emoji === "string"
  );
}

function isEvent(value: unknown): value is FamEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.text === "string" &&
    isFiniteNumber(value.at) &&
    Array.isArray(value.reactions) &&
    value.reactions.every(isReaction)
  );
}

function isSeason(value: unknown): value is SeasonResult {
  return (
    isRecord(value) &&
    typeof value.week_key === "string" &&
    isFiniteNumber(value.p1_score) &&
    isFiniteNumber(value.p2_score) &&
    isNullableString(value.winner)
  );
}

function isAchievement(value: unknown): value is Achievement {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.player_id === "string" &&
    typeof value.key === "string" &&
    typeof value.title === "string" &&
    typeof value.emoji === "string" &&
    isFiniteNumber(value.at)
  );
}

function isShelfItem(value: unknown): value is FamilyShelfItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.emoji === "string" &&
    isFiniteNumber(value.base_points) &&
    isFiniteNumber(value.hours) &&
    typeof value.repeat === "boolean" &&
    isNullableFiniteNumber(value.interval_hours)
  );
}

function isMemorableDate(value: unknown): value is MemorableDate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.date === "string" &&
    ["anniversary", "meeting", "birthday", "custom"].includes(String(value.kind))
  );
}

function isStoredState(value: unknown): value is StoredState {
  if (!isRecord(value)) return false;
  if (
    !Array.isArray(value.players) ||
    value.players.length !== 2 ||
    !value.players.every(isPlayer) ||
    value.players[0]!.id !== "p1" ||
    value.players[1]!.id !== "p2"
  ) {
    return false;
  }
  return (
    Array.isArray(value.tasks) &&
    value.tasks.every(isTask) &&
    Array.isArray(value.events) &&
    value.events.every(isEvent) &&
    typeof value.week_key === "string" &&
    Array.isArray(value.seasons) &&
    value.seasons.every(isSeason) &&
    Array.isArray(value.achievements) &&
    value.achievements.every(isAchievement) &&
    Number.isSafeInteger(value.week_burns) &&
    Number(value.week_burns) >= 0 &&
    Number.isSafeInteger(value.week_claims) &&
    Number(value.week_claims) >= 0 &&
    Array.isArray(value.family_shelf) &&
    value.family_shelf.every(isShelfItem) &&
    Array.isArray(value.memorable_dates) &&
    value.memorable_dates.every(isMemorableDate)
  );
}

const DB_KEYS = Object.keys(defaultDb()).sort();
const PLAYER_KEYS: ReadonlyArray<keyof Player> = [
  "avatar",
  "comeback_week_key",
  "id",
  "last_claim_at",
  "name",
  "score",
  "xp",
];

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isDefaultPlayer(value: unknown, expected: Player): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const player = value as Record<string, unknown>;
  if (!hasOnlyKeys(player, PLAYER_KEYS)) return false;
  return PLAYER_KEYS.every((key) => player[key] === expected[key]);
}

function hasPristineContent(state: StoredState): boolean {
  if (!hasOnlyKeys(state, DB_KEYS)) return false;

  const baseline = defaultDb();
  if (!Array.isArray(state.players) || state.players.length !== baseline.players.length) {
    return false;
  }
  if (!state.players.every((player, index) => isDefaultPlayer(player, baseline.players[index]!))) {
    return false;
  }

  const emptyCollections: Array<keyof Pick<
    Db,
    | "tasks"
    | "events"
    | "seasons"
    | "achievements"
    | "family_shelf"
    | "memorable_dates"
  >> = [
    "tasks",
    "events",
    "seasons",
    "achievements",
    "family_shelf",
    "memorable_dates",
  ];
  if (!emptyCollections.every((key) => Array.isArray(state[key]) && state[key].length === 0)) {
    return false;
  }
  return state.week_burns === 0 && state.week_claims === 0;
}

function isSystemWeekKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value)
  );
}

function mayReceiveExamples(state: StoredState, revision: number): boolean {
  if (!hasPristineContent(state)) return false;
  return (
    (revision === 0 && state.week_key === "") ||
    (revision === 1 && isSystemWeekKey(state.week_key))
  );
}

/** Adds examples only to a state snapshot proven untouched at this exact revision. */
export function applyExampleContentSeed(
  state: StoredState,
  revision: number,
  contentSeedVersion: number,
): boolean {
  if (contentSeedVersion >= CONTENT_SEED_VERSION) return false;
  if (!mayReceiveExamples(state, revision)) return false;
  state.family_shelf.push(...EXAMPLE_FAMILY_SHELF.map((item) => ({ ...item })));
  state.memorable_dates.push(...EXAMPLE_MEMORABLE_DATES.map((item) => ({ ...item })));
  return true;
}

async function bootstrapExampleContent(db: D1Database): Promise<void> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const loaded = await selectState(db);
    if (loaded.contentSeedVersion >= CONTENT_SEED_VERSION) return;

    const draft = cloneState(loaded.state);
    const shouldSeed = applyExampleContentSeed(
      draft,
      loaded.revision,
      loaded.contentSeedVersion,
    );

    let result: D1RunResult;
    try {
      if (shouldSeed) {
        const serialized = serializeState(draft);
        result = (await db
          .prepare(UPDATE_SEEDED_STATE)
          .bind(
            serialized.json,
            CONTENT_SEED_VERSION,
            Date.now(),
            loaded.revision,
            loaded.contentSeedVersion,
          )
          .run()) as D1RunResult;
      } else {
        result = (await db
          .prepare(UPDATE_CONTENT_SEED_MARKER)
          .bind(
            CONTENT_SEED_VERSION,
            Date.now(),
            loaded.revision,
            loaded.contentSeedVersion,
          )
          .run()) as D1RunResult;
      }
    } catch (error) {
      throw new StateStoreError("Не удалось сохранить примеры", { cause: error });
    }
    if (result.success === false) {
      throw new StateStoreError("Не удалось сохранить примеры");
    }
    if (changesOf(result) === 1) return;
  }

  throw new StateConflictError();
}

async function contentSeedColumnExists(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(SELECT_CONTENT_SEED_COLUMN)
    .first<ColumnCountRow>();
  const count = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new StateStoreError("Не удалось проверить структуру хранилища");
  }
  return count > 0;
}

async function ensureContentSeedColumn(db: D1Database): Promise<void> {
  if (await contentSeedColumnExists(db)) return;
  try {
    await db.prepare(ADD_CONTENT_SEED_COLUMN).run();
  } catch (error) {
    // Another isolate may have added the column after our check.
    if (await contentSeedColumnExists(db)) return;
    throw error;
  }
}

async function initializeSchema(db: D1Database): Promise<void> {
  await db.prepare(CREATE_STATE_TABLE).run();
  await ensureContentSeedColumn(db);
  const initial = JSON.stringify(defaultDb());
  if (byteLength(initial) > MAX_STATE_BYTES) {
    throw new StateStoreError("Начальное состояние превышает допустимый размер");
  }
  await db
    .prepare(INSERT_DEFAULT_STATE)
    .bind(STATE_SCHEMA_VERSION, initial, Date.now())
    .run();
  await bootstrapExampleContent(db);
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

async function selectState(db: D1Database): Promise<SelectedState> {
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
  const contentSeedVersion = Number(row.content_seed_version);
  if (schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new StateStoreError("Версия состояния приложения не поддерживается");
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new StateStoreError("Некорректная ревизия состояния приложения");
  }
  if (!Number.isSafeInteger(contentSeedVersion) || contentSeedVersion < 0) {
    throw new StateStoreError("Некорректная версия примеров");
  }
  if (typeof row.state_json !== "string") {
    throw new StateStoreError("Некорректное состояние приложения");
  }

  try {
    const state = JSON.parse(row.state_json) as StoredState;
    if (!isStoredState(state)) throw new Error("state has an invalid structure");
    return { revision, state, contentSeedVersion };
  } catch (error) {
    throw new StateStoreError("Сохранённое состояние повреждено", {
      cause: error,
    });
  }
}

export async function loadState(db: D1Database): Promise<LoadedState> {
  await ensureSchema(db);
  const loaded = await selectState(db);
  return { revision: loaded.revision, state: loaded.state };
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
