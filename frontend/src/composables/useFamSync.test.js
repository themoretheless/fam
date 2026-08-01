import { beforeEach, describe, expect, it, vi } from 'vitest'

const notificationMocks = vi.hoisted(() => ({
  maybeNotifyDeadlines: vi.fn(),
  updateTitleBadge: vi.fn()
}))

vi.mock('../notifications.js', () => notificationMocks)

import { useFamSync } from './useFamSync.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fixture(label, overrides = {}) {
  return {
    server_now: Date.parse('2026-03-16T12:00:00.000Z'),
    players: [{ id: 'p1', name: `player-${label}` }],
    tasks: [{ id: `task-${label}`, title: label, deadline: 10, created_at: 0 }],
    events: [{ id: `event-${label}` }],
    week_key: `week-${label}`,
    seasons: [{ week_key: `season-${label}` }],
    achievements: [{ id: `achievement-${label}` }],
    history: [{ id: `history-${label}` }],
    family_shelf: [{ id: `shelf-${label}`, title: label }],
    memorable_dates: [{ id: `memorable-${label}`, title: label, date: '2020-03-16', kind: 'custom' }],
    ...overrides
  }
}

function makeSync(fetchStateFn, hiddenIds = new Set()) {
  const applyWeekChange = vi.fn()
  const onAfterRefresh = vi.fn()
  const sync = useFamSync({
    hiddenIds,
    checkBurns: vi.fn(),
    applyWeekChange,
    onAfterRefresh,
    fetchStateFn
  })
  return { sync, applyWeekChange, onAfterRefresh }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useFamSync refresh single-flight', () => {
  it('discards a superseded success, runs one mandatory trailing fetch, and resolves all callers together', async () => {
    const first = deferred()
    const trailing = deferred()
    const fetchStateFn = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(trailing.promise)
    const { sync, applyWeekChange, onAfterRefresh } = makeSync(
      fetchStateFn,
      new Set(['hidden-new'])
    )

    const callerA = sync.refresh()
    const callerB = sync.refresh()

    expect(callerB).toBe(callerA)
    expect(fetchStateFn).toHaveBeenCalledTimes(1)

    first.resolve(fixture('old'))
    await flushMicrotasks()

    expect(fetchStateFn).toHaveBeenCalledTimes(2)
    expect(sync.weekKey.value).toBe('')
    expect(applyWeekChange).not.toHaveBeenCalled()
    expect(onAfterRefresh).not.toHaveBeenCalled()
    expect(notificationMocks.maybeNotifyDeadlines).not.toHaveBeenCalled()
    expect(notificationMocks.updateTitleBadge).not.toHaveBeenCalled()

    const accepted = fixture('new', {
      tasks: [
        { id: 'hidden-new', deadline: 10, created_at: 0 },
        { id: 'visible-new', deadline: 20, created_at: 0 }
      ]
    })
    trailing.resolve(accepted)

    await expect(callerA).resolves.toBe(true)
    await expect(callerB).resolves.toBe(true)
    expect(sync.players.value).toEqual(accepted.players)
    expect(sync.tasks.value).toEqual([accepted.tasks[1]])
    expect(sync.events.value).toEqual(accepted.events)
    expect(sync.weekKey.value).toBe(accepted.week_key)
    expect(sync.seasons.value).toEqual(accepted.seasons)
    expect(sync.achievements.value).toEqual(accepted.achievements)
    expect(sync.history.value).toEqual(accepted.history)
    expect(sync.familyShelf.value).toEqual(accepted.family_shelf)
    expect(sync.memorableDates.value).toEqual(accepted.memorable_dates)
    expect(sync.offline.value).toBe(false)
    expect(applyWeekChange).toHaveBeenCalledTimes(1)
    expect(applyWeekChange).toHaveBeenCalledWith(
      expect.objectContaining({ nextWeek: accepted.week_key, seasons: accepted.seasons })
    )
    expect(onAfterRefresh).toHaveBeenCalledTimes(1)
    expect(onAfterRefresh).toHaveBeenCalledWith(accepted)
    expect(notificationMocks.maybeNotifyDeadlines).toHaveBeenCalledTimes(1)
    expect(notificationMocks.updateTitleBadge).toHaveBeenCalledTimes(1)
  })

  it('ignores a superseded rejection and only clears offline after the trailing success', async () => {
    const first = deferred()
    const trailing = deferred()
    const fetchStateFn = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(trailing.promise)
    const { sync, applyWeekChange, onAfterRefresh } = makeSync(fetchStateFn)

    const result = sync.refresh()
    sync.refresh()
    first.reject(new Error('stale failure'))
    await flushMicrotasks()

    expect(fetchStateFn).toHaveBeenCalledTimes(2)
    expect(sync.offline.value).toBe(false)
    expect(applyWeekChange).not.toHaveBeenCalled()
    expect(onAfterRefresh).not.toHaveBeenCalled()

    trailing.resolve(fixture('fresh'))
    await expect(result).resolves.toBe(true)
    expect(sync.offline.value).toBe(false)
    expect(sync.weekKey.value).toBe('week-fresh')
    expect(applyWeekChange).toHaveBeenCalledTimes(1)
    expect(onAfterRefresh).toHaveBeenCalledTimes(1)
  })

  it('marks offline only when the final requested attempt fails', async () => {
    const fetchStateFn = vi.fn().mockRejectedValue(new Error('network down'))
    const { sync, applyWeekChange, onAfterRefresh } = makeSync(fetchStateFn)

    await expect(sync.refresh()).resolves.toBe(false)

    expect(sync.offline.value).toBe(true)
    expect(applyWeekChange).not.toHaveBeenCalled()
    expect(onAfterRefresh).not.toHaveBeenCalled()
    expect(notificationMocks.maybeNotifyDeadlines).not.toHaveBeenCalled()
    expect(notificationMocks.updateTitleBadge).not.toHaveBeenCalled()
  })
})

describe('useFamSync optimistic players guard', () => {
  it('protects in-flight optimistic players, accepts the next generation, and lets rollover override protection', async () => {
    const fetchStateFn = vi
      .fn()
      .mockResolvedValueOnce(fixture('in-flight', { week_key: 'week-one' }))
      .mockResolvedValueOnce(fixture('next', { week_key: 'week-one' }))
      .mockResolvedValueOnce(fixture('rollover', { week_key: 'week-two' }))
    const { sync } = makeSync(fetchStateFn)

    sync.players.value = [{ id: 'p1', name: 'optimistic-one' }]
    const protectedRefresh = sync.refresh()
    sync.markPlayersFresh()
    await expect(protectedRefresh).resolves.toBe(true)
    expect(sync.players.value).toEqual([{ id: 'p1', name: 'optimistic-one' }])

    await expect(sync.refresh()).resolves.toBe(true)
    expect(sync.players.value).toEqual([{ id: 'p1', name: 'player-next' }])

    sync.players.value = [{ id: 'p1', name: 'optimistic-two' }]
    const rolloverRefresh = sync.refresh()
    sync.markPlayersFresh()
    await expect(rolloverRefresh).resolves.toBe(true)
    expect(sync.weekKey.value).toBe('week-two')
    expect(sync.players.value).toEqual([{ id: 'p1', name: 'player-rollover' }])
  })
})
