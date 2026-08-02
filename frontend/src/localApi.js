import {
  claimTask as applyClaimTask,
  createMemorableDate as applyCreateMemorableDate,
  createShelfItem as applyCreateShelfItem,
  createTask as applyCreateTask,
  defaultDb,
  deleteMemorableDate as applyDeleteMemorableDate,
  deleteShelfItem as applyDeleteShelfItem,
  deleteTask as applyDeleteTask,
  reactEvent as applyReactEvent,
  renamePlayer as applyRenamePlayer,
  stateResponse,
  sweep,
  updateMemorableDate as applyUpdateMemorableDate,
  updateShelfItem as applyUpdateShelfItem
} from '../worker/domain.ts'
import {
  EXAMPLE_FAMILY_SHELF,
  EXAMPLE_MEMORABLE_DATES
} from '../worker/example-content.ts'
import { isStoredState } from '../worker/state-shape.ts'

export const LOCAL_DEMO_STORAGE_KEY = 'fam:github-pages:state:v1'
export const LOCAL_DEMO_CHANGE_EVENT = 'fam:github-pages:change'

const LOCK_NAME = 'fam:github-pages:state-lock:v1'
const ENVELOPE_SCHEMA_VERSION = 1
const CONTENT_SEED_VERSION = 1
const MAX_STORAGE_BYTES = 1_500_000
const MAX_ACTIVE_TASKS = 1_000
const MAX_FINISHED_TASKS = 200
const MAX_EVENTS = 30
const MAX_SEASONS = 260
const MAX_ACHIEVEMENTS = 100
const MAX_SHELF_ITEMS = 50
const MAX_MEMORABLE_DATES = 100
const ENVELOPE_KEYS = ['content_seed_version', 'revision', 'schema_version', 'state']
const STATE_KEYS = Object.keys(defaultDb()).sort()

export class LocalDemoError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'LocalDemoError'
  }
}

function storage() {
  const candidate = globalThis.localStorage
  if (!candidate) {
    throw new LocalDemoError('Локальное хранилище недоступно в этом браузере')
  }
  return candidate
}

function supportsLocks() {
  return typeof globalThis.navigator?.locks?.request === 'function'
}

export function localDemoWritesSupported() {
  return supportsLocks()
}

function bytes(value) {
  return new TextEncoder().encode(value).byteLength
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function timestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function compactState(state) {
  const active = []
  const finished = []
  state.tasks.forEach((task, index) => {
    if (task.status === 'open' || task.status === 'scheduled') active.push(task)
    else finished.push({ task, index, at: timestamp(task.finished_at ?? task.deadline) })
  })
  if (active.length > MAX_ACTIVE_TASKS) {
    throw new LocalDemoError('В демо слишком много активных дел')
  }
  finished.sort((left, right) => right.at - left.at || right.index - left.index)
  state.tasks = [...active, ...finished.slice(0, MAX_FINISHED_TASKS).map(item => item.task)]
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(0, MAX_EVENTS)
  if (state.seasons.length > MAX_SEASONS) state.seasons = state.seasons.slice(-MAX_SEASONS)
}

function serializeEnvelope(envelope) {
  compactState(envelope.state)
  let json = JSON.stringify(envelope)
  if (bytes(json) <= MAX_STORAGE_BYTES) return json
  throw new LocalDemoError('Локальные данные стали слишком большими')
}

function stateWithinLimits(state) {
  return (
    state.tasks.length <= MAX_ACTIVE_TASKS + MAX_FINISHED_TASKS &&
    state.events.length <= MAX_EVENTS &&
    state.seasons.length <= MAX_SEASONS &&
    state.achievements.length <= MAX_ACHIEVEMENTS &&
    state.family_shelf.length <= MAX_SHELF_ITEMS &&
    state.memorable_dates.length <= MAX_MEMORABLE_DATES
  )
}

function hasOnlyKeys(value, expected) {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function validEnvelope(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    hasOnlyKeys(value, ENVELOPE_KEYS) &&
    value.schema_version === ENVELOPE_SCHEMA_VERSION &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    value.content_seed_version === CONTENT_SEED_VERSION &&
    isStoredState(value.state) &&
    hasOnlyKeys(value.state, STATE_KEYS) &&
    stateWithinLimits(value.state)
  )
}

function parseEnvelope(raw) {
  if (bytes(raw) > MAX_STORAGE_BYTES) {
    throw new LocalDemoError('Локальные данные повреждены — нажмите «Сбросить демо»')
  }
  try {
    const parsed = JSON.parse(raw)
    if (!validEnvelope(parsed)) throw new Error('unsupported local state')
    return parsed
  } catch (error) {
    throw new LocalDemoError('Локальные данные повреждены — нажмите «Сбросить демо»', {
      cause: error
    })
  }
}

function seededEnvelope(now) {
  const state = defaultDb()
  state.family_shelf = EXAMPLE_FAMILY_SHELF.map(item => ({ ...item }))
  state.memorable_dates = EXAMPLE_MEMORABLE_DATES.map(item => ({ ...item }))
  sweep(state, now)
  return {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    revision: 0,
    content_seed_version: CONTENT_SEED_VERSION,
    state
  }
}

function readEnvelope(now) {
  let raw
  try {
    raw = storage().getItem(LOCAL_DEMO_STORAGE_KEY)
  } catch (error) {
    throw new LocalDemoError('Локальное хранилище недоступно в этом браузере', {
      cause: error
    })
  }
  return raw === null ? { envelope: seededEnvelope(now), isNew: true } : {
    envelope: parseEnvelope(raw),
    isNew: false
  }
}

function announceChange() {
  if (typeof globalThis.window?.dispatchEvent === 'function') {
    globalThis.window.dispatchEvent(new Event(LOCAL_DEMO_CHANGE_EVENT))
  }
}

function writeEnvelope(previous, state) {
  const next = {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    revision: previous.revision + 1,
    content_seed_version: CONTENT_SEED_VERSION,
    state
  }
  const json = serializeEnvelope(next)
  try {
    storage().setItem(LOCAL_DEMO_STORAGE_KEY, json)
  } catch (error) {
    throw new LocalDemoError('Не удалось сохранить данные в этом браузере', {
      cause: error
    })
  }
  announceChange()
  return next
}

function requireWriteLock() {
  if (!supportsLocks()) {
    throw new LocalDemoError(
      'Этот браузер поддерживает только просмотр демо — откройте страницу в современном браузере'
    )
  }
  return globalThis.navigator.locks
}

function withWriteLock(action) {
  return requireWriteLock().request(LOCK_NAME, { mode: 'exclusive' }, action)
}

async function mutate(reducer) {
  return withWriteLock(async () => {
    const now = Date.now()
    const { envelope } = readEnvelope(now)
    const state = envelope.state
    const swept = sweep(state, now)
    const sweptState = swept ? clone(state) : null

    let result
    try {
      result = reducer(state, now)
    } catch (error) {
      if (sweptState) writeEnvelope(envelope, sweptState)
      throw error
    }
    writeEnvelope(envelope, state)
    return result
  })
}

export async function fetchState() {
  const now = Date.now()
  if (!supportsLocks()) {
    const { envelope } = readEnvelope(now)
    const state = clone(envelope.state)
    sweep(state, now)
    return stateResponse(state, now)
  }

  return withWriteLock(async () => {
    const { envelope, isNew } = readEnvelope(now)
    const changed = sweep(envelope.state, now)
    if (isNew || changed) writeEnvelope(envelope, envelope.state)
    return stateResponse(envelope.state, now)
  })
}

export const createTask = task => mutate((state, now) => applyCreateTask(state, task, now))

export const createShelfItem = item => mutate(state => applyCreateShelfItem(state, item))

export const updateShelfItem = (id, item) =>
  mutate(state => applyUpdateShelfItem(state, id, item))

export const deleteShelfItem = id => mutate(state => applyDeleteShelfItem(state, id))

export const createMemorableDate = item =>
  mutate(state => applyCreateMemorableDate(state, item))

export const updateMemorableDate = (id, item) =>
  mutate(state => applyUpdateMemorableDate(state, id, item))

export const deleteMemorableDate = id =>
  mutate(state => applyDeleteMemorableDate(state, id))

export const claimTask = (id, playerId) =>
  mutate((state, now) => applyClaimTask(state, id, { player_id: playerId }, now))

export const deleteTask = id => mutate(state => applyDeleteTask(state, id))

export const renamePlayer = (id, name) =>
  mutate(state => applyRenamePlayer(state, id, { name }))

export const reactEvent = (id, playerId, emoji) =>
  mutate(state => applyReactEvent(state, id, { player_id: playerId, emoji }))

export async function resetDemoState() {
  return withWriteLock(async () => {
    try {
      storage().removeItem(LOCAL_DEMO_STORAGE_KEY)
    } catch (error) {
      throw new LocalDemoError('Не удалось сбросить данные в этом браузере', {
        cause: error
      })
    }
    announceChange()
    return { ok: true }
  })
}
