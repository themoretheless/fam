import { describe, expect, it } from 'vitest'
import {
  MEMORABLE_KIND_META,
  anniversaryProgress,
  buildMonthGrid,
  civilOrdinal,
  daysInMonth,
  formatDateKey,
  formatDateLong,
  isLeapYear,
  localDateParts,
  nextOccurrence,
  observedDateForYear,
  parseDateKey,
  upcomingMemorableDates
} from './memorableDates.js'

const d = (year, month, day) => ({ year, month, day })

describe('calendar date keys', () => {
  it('strictly parses and round-trips canonical YYYY-MM-DD', () => {
    expect(parseDateKey('2026-08-01')).toEqual(d(2026, 8, 1))
    expect(formatDateKey(d(2026, 8, 1))).toBe('2026-08-01')
    expect(formatDateKey(parseDateKey('0001-01-01'))).toBe('0001-01-01')
    expect(formatDateLong('2026-08-01')).toBe('1 августа 2026')
  })

  it.each([
    null,
    20260801,
    '',
    '2026-8-01',
    '2026-08-1',
    ' 2026-08-01',
    '2026-08-01 ',
    '0000-01-01',
    '2026-00-10',
    '2026-13-10',
    '2026-04-31',
    '2023-02-29'
  ])('rejects malformed or impossible value %s', value => {
    expect(parseDateKey(value)).toBeNull()
  })

  it('extracts local calendar components without parsing a date key', () => {
    const local = new Date(2026, 7, 1, 23, 30)
    expect(localDateParts(local)).toEqual(d(2026, 8, 1))
    expect(localDateParts('2026-08-01')).toBeNull()
    expect(localDateParts(Number.NaN)).toBeNull()
  })
})

describe('Gregorian calendar rules', () => {
  it('handles leap centuries exactly', () => {
    expect(isLeapYear(2000)).toBe(true)
    expect(isLeapYear(2100)).toBe(false)
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2025)).toBe(false)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(2100, 2)).toBe(28)
  })

  it('observes February 29 on February 28 in a non-leap year', () => {
    expect(observedDateForYear('2020-02-29', 2024)).toEqual(d(2024, 2, 29))
    expect(observedDateForYear('2020-02-29', 2025)).toEqual(d(2025, 2, 28))
    expect(observedDateForYear('2020-02-29', 2100)).toEqual(d(2100, 2, 28))
  })

  it('uses civil ordinals unaffected by DST-length days', () => {
    expect(civilOrdinal('1970-01-01')).toBe(0)
    expect(civilOrdinal('2026-03-29') - civilOrdinal('2026-03-28')).toBe(1)
    expect(civilOrdinal('2026-11-01') - civilOrdinal('2026-10-31')).toBe(1)
    expect(civilOrdinal('2025-01-01') - civilOrdinal('2024-01-01')).toBe(366)
  })
})

describe('nextOccurrence', () => {
  it('includes today as the nearest occurrence', () => {
    expect(nextOccurrence('2020-08-15', d(2026, 8, 15))).toEqual({
      date: d(2026, 8, 15),
      key: '2026-08-15',
      daysUntil: 0,
      anniversaryNumber: 6
    })
  })

  it('crosses December to January without timestamp arithmetic', () => {
    expect(nextOccurrence('2020-01-01', d(2026, 12, 31))).toEqual({
      date: d(2027, 1, 1),
      key: '2027-01-01',
      daysUntil: 1,
      anniversaryNumber: 7
    })
    expect(nextOccurrence('2020-12-31', d(2026, 1, 1)).daysUntil).toBe(364)
  })

  it('applies the February 29 observation rule before, on, and after the date', () => {
    expect(nextOccurrence('2020-02-29', d(2025, 2, 27))).toMatchObject({
      key: '2025-02-28',
      daysUntil: 1,
      anniversaryNumber: 5
    })
    expect(nextOccurrence('2020-02-29', d(2025, 2, 28))).toMatchObject({
      key: '2025-02-28',
      daysUntil: 0,
      anniversaryNumber: 5
    })
    expect(nextOccurrence('2020-02-29', d(2025, 3, 1))).toMatchObject({
      key: '2026-02-28',
      anniversaryNumber: 6
    })
    expect(nextOccurrence('2020-02-29', d(2024, 2, 28))).toMatchObject({
      key: '2024-02-29',
      daysUntil: 1,
      anniversaryNumber: 4
    })
  })

  it('never invents an annual occurrence before a future anchor', () => {
    expect(nextOccurrence('2027-05-10', d(2026, 8, 1))).toEqual({
      date: d(2027, 5, 10),
      key: '2027-05-10',
      daysUntil: 282,
      anniversaryNumber: 0
    })
  })
})

describe('anniversaryProgress', () => {
  it.each([
    [d(2026, 8, 14), { started: true, fullYears: 5, daysAfterAnniversary: 364, totalDays: 2190 }],
    [d(2026, 8, 15), { started: true, fullYears: 6, daysAfterAnniversary: 0, totalDays: 2191 }],
    [d(2026, 8, 16), { started: true, fullYears: 6, daysAfterAnniversary: 1, totalDays: 2192 }]
  ])('calculates ordinary anniversary progress at %o', (today, expected) => {
    expect(anniversaryProgress('2020-08-15', today)).toEqual(expected)
  })

  it('keeps February 29 progress consistent with its observed anniversary', () => {
    expect(anniversaryProgress('2020-02-29', d(2025, 2, 27))).toEqual({
      started: true,
      fullYears: 4,
      daysAfterAnniversary: 364,
      totalDays: 1825
    })
    expect(anniversaryProgress('2020-02-29', d(2025, 2, 28))).toEqual({
      started: true,
      fullYears: 5,
      daysAfterAnniversary: 0,
      totalDays: 1826
    })
    expect(anniversaryProgress('2020-02-29', d(2025, 3, 1))).toEqual({
      started: true,
      fullYears: 5,
      daysAfterAnniversary: 1,
      totalDays: 1827
    })
  })

  it('protects future anchors with zero progress', () => {
    expect(anniversaryProgress('2027-05-10', d(2026, 8, 1))).toEqual({
      started: false,
      fullYears: 0,
      daysAfterAnniversary: 0,
      totalDays: 0
    })
  })
})

describe('upcomingMemorableDates', () => {
  const today = d(2026, 8, 1)

  it('sorts by next occurrence, older original anchor, then id', () => {
    const items = [
      { id: 'z', title: 'Позже', date: '2021-08-03', kind: 'custom' },
      { id: 'b', title: 'Младше', date: '2022-08-02', kind: 'birthday' },
      { id: 'c', title: 'Старше, c', date: '2018-08-02', kind: 'anniversary' },
      { id: 'a', title: 'Старше, a', date: '2018-08-02', kind: 'meeting' }
    ]

    const result = upcomingMemorableDates(items, today)
    expect(result.map(item => item.id)).toEqual(['a', 'c', 'b', 'z'])
    expect(result[0].occurrence.daysUntil).toBe(1)
    expect(result[0].progress.fullYears).toBe(7)
    expect(result[0].kindMeta).toBe(MEMORABLE_KIND_META.meeting)
  })

  it('puts today first, applies a limit, filters invalid dates, and falls back to custom meta', () => {
    const result = upcomingMemorableDates([
      { id: 'later', date: '2020-08-02', kind: 'birthday' },
      { id: 'today', date: '2020-08-01', kind: 'unknown' },
      { id: 'bad', date: '2026-02-30', kind: 'custom' }
    ], today, 1)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('today')
    expect(result[0].occurrence.daysUntil).toBe(0)
    expect(result[0].kindMeta).toBe(MEMORABLE_KIND_META.custom)
  })

  it('publishes exactly the four supported kind definitions', () => {
    expect(Object.keys(MEMORABLE_KIND_META)).toEqual([
      'anniversary',
      'meeting',
      'birthday',
      'custom'
    ])
    expect(MEMORABLE_KIND_META.meeting).toEqual({ label: 'День встречи', emoji: '🤝' })
    expect(MEMORABLE_KIND_META.custom).toEqual({ label: 'Другое', emoji: '⭐' })
  })
})

describe('buildMonthGrid', () => {
  it('always returns six Monday-first weeks and marks the target month', () => {
    const grid = buildMonthGrid(2026, 8, [], d(2026, 8, 17))
    expect(grid).toHaveLength(42)
    expect(grid[0].key).toBe('2026-07-27')
    expect(grid[6].key).toBe('2026-08-02')
    expect(grid[41].key).toBe('2026-09-06')
    expect(grid.filter(cell => cell.inMonth)).toHaveLength(31)
    expect(grid.find(cell => cell.isToday)?.key).toBe('2026-08-17')
  })

  it('attaches annual events, including observed February 29 events', () => {
    const items = [
      { id: 'leap', title: 'Leap', date: '2020-02-29', kind: 'anniversary' },
      { id: 'regular', title: 'Regular', date: '2022-02-28', kind: 'birthday' },
      { id: 'future', title: 'Future', date: '2026-02-28', kind: 'custom' }
    ]
    const grid = buildMonthGrid(2025, 2, items, d(2025, 2, 1))
    const observed = grid.find(cell => cell.key === '2025-02-28')

    expect(observed.events.map(event => event.id)).toEqual(['leap', 'regular'])
    expect(observed.events.map(event => event.anniversaryNumber)).toEqual([5, 3])
    expect(grid.flatMap(cell => cell.events).some(event => event.id === 'future')).toBe(false)
  })

  it('handles a month grid crossing a civil year boundary', () => {
    const grid = buildMonthGrid(2026, 12, [
      { id: 'new-year', date: '2020-01-01', kind: 'custom' }
    ], d(2026, 12, 1))
    const januaryFirst = grid.find(cell => cell.key === '2027-01-01')
    expect(januaryFirst.events).toHaveLength(1)
    expect(januaryFirst.events[0].anniversaryNumber).toBe(7)
  })
})
