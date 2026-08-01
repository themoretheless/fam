import { describe, it, expect, beforeEach } from 'vitest'
import {
  PRESETS,
  SIZE_PRESETS,
  matchHeuristic,
  filterPresets,
  loadAddDefaults,
  saveAddDefaults,
  positiveFiniteNumber,
  resolvePresetInterval,
  isCustomInterval,
  normalizeAddDefaults,
  filterFamilyShelf,
  buildShelfPayload
} from './presets.js'

describe('PRESETS', () => {
  it('has at least 20 items with required fields', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(20)
    for (const p of PRESETS) {
      expect(p.id).toBeTruthy()
      expect(p.title).toBeTruthy()
      expect(p.emoji).toBeTruthy()
      expect(p.base_points).toBeGreaterThan(0)
      expect(p.hours).toBeGreaterThan(0)
      expect(Array.isArray(p.tags)).toBe(true)
    }
  })
})

describe('SIZE_PRESETS', () => {
  it('has light normal heavy', () => {
    expect(SIZE_PRESETS.map(s => s.id)).toEqual(['light', 'normal', 'heavy'])
  })
})

describe('matchHeuristic', () => {
  it('matches kitchen trash', () => {
    expect(matchHeuristic('вынести мусор').emoji).toBe('🗑️')
    expect(matchHeuristic('Помыть посуду').emoji).toBe('🍽️')
  })
  it('returns null for empty or unknown', () => {
    expect(matchHeuristic('')).toBeNull()
    expect(matchHeuristic('xyzabc')).toBeNull()
  })
  it('washer is laundry not car', () => {
    expect(matchHeuristic('стиральная машина').emoji).toBe('🧺')
  })
})

describe('filterPresets', () => {
  it('filters by group and query', () => {
    const kitchen = filterPresets(PRESETS, '', 'кухня')
    expect(kitchen.every(p => p.tags.includes('кухня'))).toBe(true)
    const q = filterPresets(PRESETS, 'мусор', 'all')
    expect(q.some(p => p.title.toLowerCase().includes('мусор'))).toBe(true)
  })
  it('empty query returns group slice', () => {
    const all = filterPresets(PRESETS, '', 'all')
    expect(all.length).toBe(PRESETS.length)
  })
})

describe('repeat interval helpers', () => {
  it('uses auto mode and the fuse for presets without an explicit interval', () => {
    expect(resolvePresetInterval({ hours: 6, repeat: true })).toEqual({
      interval_hours: 6,
      custom: false
    })
    expect(resolvePresetInterval({ hours: 12, repeat: true })).toEqual({
      interval_hours: 12,
      custom: false
    })
  })

  it('uses custom mode for an explicit valid preset interval', () => {
    expect(resolvePresetInterval({ hours: 6, interval_hours: 24, repeat: true })).toEqual({
      interval_hours: 24,
      custom: true
    })
  })

  it('keeps an explicit interval equal to the fuse in auto mode', () => {
    expect(resolvePresetInterval({ hours: 12, interval_hours: 12, repeat: true })).toEqual({
      interval_hours: 12,
      custom: false
    })
  })

  it('infers restored custom mode only when interval and fuse differ', () => {
    expect(isCustomInterval(36, 12)).toBe(true)
    expect(isCustomInterval(12, 12)).toBe(false)
  })

  it('only accepts finite positive numbers', () => {
    expect(positiveFiniteNumber('6')).toBe(6)
    expect(positiveFiniteNumber(0)).toBeNull()
    expect(positiveFiniteNumber(-1)).toBeNull()
    expect(positiveFiniteNumber(Infinity)).toBeNull()
    expect(positiveFiniteNumber('nope')).toBeNull()
  })

  it('strictly normalizes stored numeric fields', () => {
    expect(
      normalizeAddDefaults({
        emoji: '🐾',
        base_points: Infinity,
        hours: -12,
        interval_hours: 0,
        repeat: true
      })
    ).toEqual({
      emoji: '🐾',
      base_points: null,
      hours: null,
      interval_hours: null,
      repeat: true
    })
  })
})

describe('family shelf helpers', () => {
  const shelf = [
    { id: 'one', title: 'Полить орхидеи' },
    { id: 'two', title: 'КУПИТЬ корм' }
  ]

  it('searches family templates case-insensitively without mutating the source', () => {
    const result = filterFamilyShelf(shelf, '  купить ')
    expect(result).toEqual([shelf[1]])
    expect(filterFamilyShelf(shelf, '')).toEqual(shelf)
    expect(filterFamilyShelf(shelf, '')).not.toBe(shelf)
  })

  it('sends an interval only for a custom repeating template', () => {
    const base = {
      title: 'Полить цветы',
      emoji: '🪴',
      base_points: 10,
      hours: 12,
      repeat: true,
      interval_hours: 36
    }

    expect(buildShelfPayload({ ...base, interval_custom: false })).not.toHaveProperty(
      'interval_hours'
    )
    expect(buildShelfPayload({ ...base, repeat: false, interval_custom: true })).not.toHaveProperty(
      'interval_hours'
    )
    expect(buildShelfPayload({ ...base, interval_custom: true })).toMatchObject({
      repeat: true,
      interval_hours: 36
    })
  })

  it('uses finite positive defaults for invalid numeric input', () => {
    expect(
      buildShelfPayload({
        title: '  Дело  ',
        emoji: '',
        base_points: Infinity,
        hours: -1,
        repeat: true,
        interval_custom: true,
        interval_hours: Number.NaN
      })
    ).toEqual({
      title: 'Дело',
      emoji: '🧺',
      base_points: 10,
      hours: 24,
      repeat: true,
      interval_hours: 24
    })
  })
})

describe('add defaults', () => {
  beforeEach(() => {
    const mem = new Map()
    globalThis.localStorage = {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: k => mem.delete(k)
    }
  })
  it('roundtrips a custom repeat interval', () => {
    saveAddDefaults({
      emoji: '🛒',
      base_points: 20,
      hours: 12,
      interval_hours: 36,
      repeat: true
    })
    const d = loadAddDefaults()
    expect(d).not.toBeNull()
    expect(d.emoji).toBe('🛒')
    expect(d.base_points).toBe(20)
    expect(d.hours).toBe(12)
    expect(d.interval_hours).toBe(36)
    expect(d.repeat).toBe(true)
  })

  it('migrates legacy defaults by using hours as the repeat interval', () => {
    localStorage.setItem(
      'fam-add-defaults',
      JSON.stringify({ emoji: '🐕', base_points: 15, hours: 6, repeat: true })
    )

    expect(loadAddDefaults()).toMatchObject({
      hours: 6,
      interval_hours: 6,
      repeat: true
    })
  })
})
