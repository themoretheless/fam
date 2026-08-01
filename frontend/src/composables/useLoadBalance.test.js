import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { buildWeekDailyBalance, useLoadBalance } from './useLoadBalance.js'

const monday = Date.parse('2026-03-16T00:00:00.000Z')

describe('buildWeekDailyBalance', () => {
  it('uses UTC day boundaries and sorts grouped days chronologically', () => {
    const result = buildWeekDailyBalance(
      [
        { status: 'burned', finished_at: Date.parse('2026-03-18T00:00:00.000Z') },
        { status: 'done', claimed_by: 'p2', awarded_points: 8, finished_at: Date.parse('2026-03-16T23:59:59.999Z') },
        { status: 'done', claimed_by: 'p1', awarded_points: 12, finished_at: Date.parse('2026-03-17T00:00:00.000Z') }
      ],
      monday
    )

    expect(result.map(day => day.date)).toEqual(['2026-03-16', '2026-03-17', '2026-03-18'])
    expect(result[0].p2).toEqual({ doneCount: 1, awardedPoints: 8 })
    expect(result[1].p1).toEqual({ doneCount: 1, awardedPoints: 12 })
    expect(result[2].burnedCount).toBe(1)
  })

  it('counts done work, awarded points, and burns within each day', () => {
    const at = Date.parse('2026-03-19T12:00:00.000Z')
    const [day] = buildWeekDailyBalance(
      [
        { status: 'done', claimed_by: 'p1', awarded_points: 10, finished_at: at },
        { status: 'done', claimed_by: 'p1', awarded_points: 15, finished_at: at + 1 },
        { status: 'done', claimed_by: 'p2', awarded_points: 7, finished_at: at + 2 },
        { status: 'burned', finished_at: at + 3 },
        { status: 'burned', finished_at: at + 4 }
      ],
      monday
    )

    expect(day).toMatchObject({
      date: '2026-03-19',
      p1: { doneCount: 2, awardedPoints: 25 },
      p2: { doneCount: 1, awardedPoints: 7 },
      burnedCount: 2
    })
  })

  it('excludes pre-week, next-week, malformed, and irrelevant records', () => {
    expect(buildWeekDailyBalance([
      { status: 'done', claimed_by: 'p1', awarded_points: 99, finished_at: monday - 1 },
      { status: 'done', claimed_by: 'p1', awarded_points: 99, finished_at: monday + 7 * 86400000 },
      { status: 'done', claimed_by: 'p1', awarded_points: 99, finished_at: 'not-a-number' },
      { status: 'done', claimed_by: 'other', awarded_points: 99, finished_at: monday },
      { status: 'open', claimed_by: 'p1', awarded_points: 99, finished_at: monday }
    ], monday)).toEqual([])
  })
})

describe('useLoadBalance daily breakdown', () => {
  it('keeps weekly totals in sync with the computed UTC breakdown', () => {
    const history = ref([
      { status: 'done', claimed_by: 'p1', awarded_points: 5, finished_at: monday },
      { status: 'done', claimed_by: 'p2', awarded_points: 9, finished_at: monday + 1 },
      { status: 'burned', finished_at: monday + 2 }
    ])
    const balance = useLoadBalance(history, ref(monday))

    expect(balance.weekDailyBalance.value).toHaveLength(1)
    expect(balance.weekDone.value).toEqual({ p1: 1, p2: 1 })
    expect(balance.weekBurned.value).toBe(1)
  })
})
