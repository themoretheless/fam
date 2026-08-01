import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { startOfIsoWeekUtc, useStats } from './useStats.js'
import { useLoadBalance } from './useLoadBalance.js'

describe('startOfIsoWeekUtc', () => {
  it('keeps Sunday in the ISO week that began on the previous Monday', () => {
    const sundayEnd = Date.parse('2026-03-15T23:59:59.999Z')

    expect(startOfIsoWeekUtc(sundayEnd)).toBe(Date.parse('2026-03-09T00:00:00.000Z'))
  })

  it('moves to the new ISO week exactly at Monday 00:00 UTC', () => {
    const mondayStart = Date.parse('2026-03-16T00:00:00.000Z')

    expect(startOfIsoWeekUtc(mondayStart)).toBe(mondayStart)
  })
})

describe('weekly stats filtering', () => {
  it('excludes records before the UTC boundary and includes records on or after it', () => {
    const boundary = Date.parse('2026-03-16T00:00:00.000Z')
    const history = ref([
      {
        status: 'done',
        claimed_by: 'p1',
        finished_at: boundary - 1,
        deadline: boundary + 30_000,
        base_points: 10,
        awarded_points: 10
      },
      { status: 'burned', finished_at: boundary - 1 },
      {
        status: 'done',
        claimed_by: 'p1',
        finished_at: boundary,
        deadline: boundary + 30_000,
        base_points: 10,
        awarded_points: 20
      },
      {
        status: 'done',
        claimed_by: 'p2',
        finished_at: boundary + 1,
        deadline: boundary + 300_000,
        base_points: 10,
        awarded_points: 10
      },
      { status: 'burned', finished_at: boundary + 1 }
    ])
    const stats = useStats({
      history,
      now: ref(Date.parse('2026-03-16T12:00:00.000Z')),
      p1: ref({ xp: 0 }),
      p2: ref({ xp: 0 })
    })
    const loadBalance = useLoadBalance(history, stats.weekStart)

    expect(stats.weekStart.value).toBe(boundary)
    expect(stats.avgMult.value).toBe(1.5)
    expect(stats.firefightersWeek.value).toBe(1)
    expect(loadBalance.weekDone.value).toEqual({ p1: 1, p2: 1 })
    expect(loadBalance.weekBurned.value).toBe(1)
  })
})
