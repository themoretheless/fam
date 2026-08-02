import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const apiMocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  renamePlayer: vi.fn()
}))

const soundMocks = vi.hoisted(() => ({
  playAdd: vi.fn()
}))

vi.mock('../api.js', () => apiMocks)
vi.mock('../sounds.js', () => soundMocks)

import { STARTER_TASKS, useOnboarding } from './useOnboarding.js'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('location', { hostname: 'example.test' })
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useOnboarding starter examples', () => {
  it('keeps every starter visibly marked and demonstrates a 72-hour repeat', () => {
    expect(STARTER_TASKS).toEqual([
      {
        title: 'Пример: помыть посуду',
        emoji: '🍽️',
        base_points: 10,
        hours: 6,
        repeat: false
      },
      {
        title: 'Пример: вынести мусор',
        emoji: '🗑️',
        base_points: 15,
        hours: 12,
        repeat: false
      },
      {
        title: 'Пример: полить растения',
        emoji: '🪴',
        base_points: 10,
        hours: 24,
        repeat: true,
        interval_hours: 72
      }
    ])
  })

  it('creates the three examples in order when the starter pack is chosen', async () => {
    apiMocks.createTask.mockResolvedValue({})
    const refresh = vi.fn().mockResolvedValue(undefined)
    const onboarding = useOnboarding({
      p1: ref({ name: 'Игрок 1', score: 0, xp: 0 }),
      p2: ref({ name: 'Игрок 2', score: 0, xp: 0 }),
      sortedTasks: ref([]),
      history: ref([]),
      events: ref([]),
      showToast: vi.fn(),
      refresh
    })

    await onboarding.seedStarter()

    expect(apiMocks.createTask.mock.calls.map(([task]) => task)).toEqual(STARTER_TASKS)
    expect(soundMocks.playAdd).toHaveBeenCalledTimes(1)
    expect(localStorage.setItem).toHaveBeenCalledWith('fam-starter-used', '1')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onboarding.starterBusy.value).toBe(false)
  })
})
