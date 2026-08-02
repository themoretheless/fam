import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_DEMO_STORAGE_KEY,
  claimTask,
  createMemorableDate,
  createShelfItem,
  createTask,
  deleteMemorableDate,
  deleteShelfItem,
  fetchState,
  localDemoWritesSupported,
  reactEvent,
  renamePlayer,
  resetDemoState,
  updateMemorableDate,
  updateShelfItem
} from './localApi.js'

const FIXED_NOW = Date.parse('2026-08-02T12:00:00.000Z')

function memoryStorage() {
  const values = new Map()
  let failWrites = false
  return {
    values,
    failNextWrites() {
      failWrites = true
    },
    getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => {
      if (failWrites) throw new DOMException('quota', 'QuotaExceededError')
      values.set(key, String(value))
    }),
    removeItem: vi.fn(key => values.delete(key))
  }
}

let storage
let id

beforeEach(() => {
  storage = memoryStorage()
  id = 0
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn((_name, _options, action) => action())
    }
  })
  vi.stubGlobal('crypto', { randomUUID: () => `local-id-${++id}` })
  vi.stubGlobal('Event', class EventMock {
    constructor(type) {
      this.type = type
    }
  })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('GitHub Pages local API', () => {
  it('seeds neutral examples once and never restores deleted examples', async () => {
    const initial = await fetchState()

    expect(initial.tasks).toEqual([])
    expect(initial.family_shelf).toHaveLength(2)
    expect(initial.memorable_dates).toHaveLength(2)
    expect(storage.values.has(LOCAL_DEMO_STORAGE_KEY)).toBe(true)

    const shelfId = initial.family_shelf[0].id
    const dateId = initial.memorable_dates[0].id
    await deleteShelfItem(shelfId)
    await deleteMemorableDate(dateId)

    const reloaded = await fetchState()
    expect(reloaded.family_shelf.map(item => item.id)).not.toContain(shelfId)
    expect(reloaded.memorable_dates.map(item => item.id)).not.toContain(dateId)
    expect(reloaded.family_shelf).toHaveLength(1)
    expect(reloaded.memorable_dates).toHaveLength(1)
  })

  it('persists task, player, claim, event, and reaction changes', async () => {
    const task = await createTask({
      title: 'Полить цветы',
      emoji: '🪴',
      base_points: 20,
      hours: 12,
      repeat: false,
      interval_hours: null
    })
    await renamePlayer('p1', 'Лиса')
    const claim = await claimTask(task.id, 'p1')

    expect(claim.players.find(player => player.id === 'p1').score).toBeGreaterThan(0)

    let state = await fetchState()
    expect(state.tasks).toEqual([])
    expect(state.history).toEqual([expect.objectContaining({ id: task.id, status: 'done' })])
    expect(state.players[0].name).toBe('Лиса')

    const doneEvent = state.events.find(event => event.kind === 'done')
    await reactEvent(doneEvent.id, 'p2', '❤️')
    state = await fetchState()
    expect(state.events.find(event => event.id === doneEvent.id).reactions).toEqual([
      { player_id: 'p2', emoji: '❤️' }
    ])
  })

  it('commits an expiry sweep even when the following claim is rejected', async () => {
    const task = await createTask({
      title: 'Срочное дело',
      emoji: '⏳',
      base_points: 20,
      hours: 0.05,
      repeat: false,
      interval_hours: null
    })
    Date.now.mockReturnValue(task.deadline + 1)

    await expect(claimTask(task.id, 'p1')).rejects.toThrow('уже сгорело')
    const state = await fetchState()
    expect(state.history).toEqual([
      expect.objectContaining({ id: task.id, status: 'burned' })
    ])
    expect(state.events.some(event => event.kind === 'burn')).toBe(true)
  })

  it('persists a repeating task and opens it when its next interval arrives', async () => {
    const task = await createTask({
      title: 'Проверить растения',
      emoji: '🌿',
      base_points: 10,
      hours: 1,
      repeat: true,
      interval_hours: 24
    })
    await claimTask(task.id, 'p2')
    expect((await fetchState()).tasks).toEqual([])

    Date.now.mockReturnValue(FIXED_NOW + 24 * 60 * 60 * 1000 + 1)
    const state = await fetchState()
    expect(state.tasks).toEqual([
      expect.objectContaining({ title: 'Проверить растения', status: 'open' })
    ])
    expect(state.events.some(event => event.kind === 'repeat')).toBe(true)
  })

  it('supports shelf and memorable-date CRUD with the shared validation rules', async () => {
    const shelf = await createShelfItem({
      title: 'Купить продукты',
      emoji: '🛒',
      base_points: 15,
      hours: 8,
      repeat: false,
      interval_hours: null
    })
    const updatedShelf = await updateShelfItem(shelf.id, {
      title: 'Купить продукты на неделю',
      emoji: '🛒',
      base_points: 25,
      hours: 10,
      repeat: true,
      interval_hours: 168
    })
    expect(updatedShelf).toMatchObject({ title: 'Купить продукты на неделю', repeat: true })

    const date = await createMemorableDate({
      title: 'День первой встречи',
      date: '2020-05-14',
      kind: 'meeting'
    })
    const updatedDate = await updateMemorableDate(date.id, {
      title: 'Годовщина первой встречи',
      date: '2020-05-14',
      kind: 'anniversary'
    })
    expect(updatedDate.kind).toBe('anniversary')

    await deleteShelfItem(shelf.id)
    await deleteMemorableDate(date.id)
    const state = await fetchState()
    expect(state.family_shelf.some(item => item.id === shelf.id)).toBe(false)
    expect(state.memorable_dates.some(item => item.id === date.id)).toBe(false)
  })

  it('does not silently overwrite malformed local data and offers an explicit reset', async () => {
    storage.values.set(LOCAL_DEMO_STORAGE_KEY, '{"unexpected":true}')

    await expect(fetchState()).rejects.toThrow('Локальные данные повреждены')
    expect(storage.values.get(LOCAL_DEMO_STORAGE_KEY)).toBe('{"unexpected":true}')

    await resetDemoState()
    expect(storage.values.has(LOCAL_DEMO_STORAGE_KEY)).toBe(false)
    await expect(fetchState()).resolves.toMatchObject({
      tasks: [],
      family_shelf: expect.any(Array),
      memorable_dates: expect.any(Array)
    })
  })

  it('reports storage failures without changing the last committed state', async () => {
    await fetchState()
    const committed = storage.values.get(LOCAL_DEMO_STORAGE_KEY)
    storage.failNextWrites()

    await expect(
      createTask({ title: 'Не сохранится', emoji: '📌', base_points: 10, hours: 1 })
    ).rejects.toThrow('Не удалось сохранить данные')
    expect(storage.values.get(LOCAL_DEMO_STORAGE_KEY)).toBe(committed)
  })

  it('falls back to read-only mode when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {})

    expect(localDemoWritesSupported()).toBe(false)
    await expect(fetchState()).resolves.toMatchObject({ tasks: [] })
    expect(storage.values.has(LOCAL_DEMO_STORAGE_KEY)).toBe(false)
    await expect(
      createTask({ title: 'Только чтение', emoji: '📌', base_points: 10, hours: 1 })
    ).rejects.toThrow('поддерживает только просмотр')
  })
})
