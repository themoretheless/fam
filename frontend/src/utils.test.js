import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  formatPointsWord,
  levelFromXp,
  levelTitle,
  levelProgress,
  formatAgo,
  LEVEL_TITLES
} from './utils.js'

describe('formatPointsWord', () => {
  it.each([
    [0, 'очков'],
    [1, 'очко'],
    [2, 'очка'],
    [5, 'очков'],
    [11, 'очков'],
    [12, 'очков'],
    [13, 'очков'],
    [14, 'очков'],
    [21, 'очко'],
    [22, 'очка'],
    [25, 'очков'],
    [111, 'очков'],
    [-1, 'очко'],
    [-2, 'очка'],
    [-5, 'очков']
  ])('formats %i as %s', (points, expected) => {
    expect(formatPointsWord(points)).toBe(expected)
  })
})

describe('formatDuration', () => {
  it('burns at zero or negative', () => {
    expect(formatDuration(0)).toBe('сгорело')
    expect(formatDuration(-1)).toBe('сгорело')
  })
  it('seconds under a minute', () => {
    expect(formatDuration(500)).toBe('1с')
    expect(formatDuration(1500)).toBe('2с')
  })
  it('minutes and hours', () => {
    expect(formatDuration(60_000)).toBe('1м')
    expect(formatDuration(3_600_000)).toBe('1ч 0м')
    expect(formatDuration(3_660_000)).toBe('1ч 1м')
  })
  it('days', () => {
    expect(formatDuration(86_400_000)).toBe('1д 0ч')
  })
})

describe('levelFromXp', () => {
  it('treats bad values as 0 xp → level 1', () => {
    expect(levelFromXp(undefined)).toBe(1)
    expect(levelFromXp(null)).toBe(1)
    expect(levelFromXp('x')).toBe(1)
    expect(levelFromXp(-10)).toBe(1)
    expect(levelFromXp(0)).toBe(1)
  })
  it('thresholds', () => {
    expect(levelFromXp(49)).toBe(1)
    expect(levelFromXp(50)).toBe(2)
    expect(levelFromXp(200)).toBe(3)
  })
})

describe('levelTitle', () => {
  it('maps 1..6 and caps at legend', () => {
    expect(levelTitle(1)).toBe(LEVEL_TITLES[0])
    expect(levelTitle(6)).toBe('Легенда чистоты')
    expect(levelTitle(99)).toBe('Легенда чистоты')
  })
})

describe('levelProgress', () => {
  it('starts at 0 on level boundary', () => {
    expect(levelProgress(0)).toBe(0)
    expect(levelProgress(50)).toBe(0)
  })
  it('mid and clamp', () => {
    // level 1: 0..50, at 25 → 0.5
    expect(levelProgress(25)).toBeCloseTo(0.5, 5)
    expect(levelProgress(-5)).toBe(0)
  })
})

describe('formatAgo', () => {
  const now = 1_000_000_000_000
  it('just now', () => {
    expect(formatAgo(now - 10_000, now)).toBe('только что')
    expect(formatAgo(now + 5000, now)).toBe('только что')
  })
  it('minutes hours days with plurals', () => {
    expect(formatAgo(now - 1 * 60_000, now)).toBe('1 минуту назад')
    expect(formatAgo(now - 2 * 60_000, now)).toBe('2 минуты назад')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 минут назад')
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe('2 часа назад')
    expect(formatAgo(now - 5 * 3_600_000, now)).toBe('5 часов назад')
    expect(formatAgo(now - 1 * 86_400_000, now)).toBe('1 день назад')
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe('3 дня назад')
  })
})

describe('level titles neutral', () => {
  it('no male-only -ник mid titles', () => {
    expect(LEVEL_TITLES[1]).toBe('В деле')
    expect(LEVEL_TITLES[2]).toBe('На подъёме')
  })
})
