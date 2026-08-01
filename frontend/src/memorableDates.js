const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
]

export const MEMORABLE_KIND_META = Object.freeze({
  anniversary: Object.freeze({ label: 'Годовщина', emoji: '💍' }),
  meeting: Object.freeze({ label: 'День встречи', emoji: '🤝' }),
  birthday: Object.freeze({ label: 'День рождения', emoji: '🎂' }),
  custom: Object.freeze({ label: 'Другое', emoji: '⭐' })
})

export function isLeapYear(year) {
  return (
    Number.isInteger(year) &&
    year >= 1 &&
    year <= 9999 &&
    year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0)
  )
}

export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return 0
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function parseDateKey(key) {
  if (typeof key !== 'string') return null
  const match = DATE_KEY_RE.exec(key)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

function normalizedDate(value) {
  if (typeof value === 'string') return parseDateKey(value)
  if (!value || typeof value !== 'object') return null
  if (!('year' in value) && 'date' in value) return normalizedDate(value.date)

  const { year, month, day } = value
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year < 1 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function formatDateKey(value) {
  const date = normalizedDate(value)
  if (!date) return null
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

export function localDateParts(now = Date.now()) {
  if (!(now instanceof Date) && typeof now !== 'number') return null
  const date = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(date.getTime())) return null
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  }
}

/** Number of civil midnights since 1970-01-01 in the proleptic Gregorian calendar. */
export function civilOrdinal(value) {
  const date = normalizedDate(value)
  if (!date) return null

  let year = date.year
  year -= date.month <= 2 ? 1 : 0
  const era = Math.floor(year / 400)
  const yearOfEra = year - era * 400
  const adjustedMonth = date.month + (date.month > 2 ? -3 : 9)
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + date.day - 1
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear
  return era * 146097 + dayOfEra - 719468
}

function dateFromCivilOrdinal(ordinal) {
  if (!Number.isInteger(ordinal)) return null

  const shifted = ordinal + 719468
  const era = Math.floor(shifted / 146097)
  const dayOfEra = shifted - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365
  )
  let year = yearOfEra + era * 400
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const adjustedMonth = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * adjustedMonth + 2) / 5) + 1
  const month = adjustedMonth + (adjustedMonth < 10 ? 3 : -9)
  year += month <= 2 ? 1 : 0

  return normalizedDate({ year, month, day })
}

export function observedDateForYear(itemOrDate, year) {
  const original = normalizedDate(itemOrDate)
  if (!original || !Number.isInteger(year) || year < 1 || year > 9999) return null
  if (original.month === 2 && original.day === 29 && !isLeapYear(year)) {
    return { year, month: 2, day: 28 }
  }
  return { year, month: original.month, day: original.day }
}

export function nextOccurrence(itemOrDate, today = localDateParts()) {
  const original = normalizedDate(itemOrDate)
  const current = normalizedDate(today)
  if (!original || !current) return null

  const originalOrdinal = civilOrdinal(original)
  const todayOrdinal = civilOrdinal(current)
  let date

  // An annual series never creates an occurrence before its original anchor.
  if (originalOrdinal > todayOrdinal) {
    date = original
  } else {
    date = observedDateForYear(original, current.year)
    if (civilOrdinal(date) < todayOrdinal) {
      date = observedDateForYear(original, current.year + 1)
    }
  }

  if (!date) return null
  return {
    date,
    key: formatDateKey(date),
    daysUntil: civilOrdinal(date) - todayOrdinal,
    anniversaryNumber: date.year - original.year
  }
}

export function anniversaryProgress(itemOrDate, today = localDateParts()) {
  const original = normalizedDate(itemOrDate)
  const current = normalizedDate(today)
  if (!original || !current) return null

  const originalOrdinal = civilOrdinal(original)
  const todayOrdinal = civilOrdinal(current)
  if (originalOrdinal > todayOrdinal) {
    return {
      started: false,
      fullYears: 0,
      daysAfterAnniversary: 0,
      totalDays: 0
    }
  }

  let lastAnniversary = observedDateForYear(original, current.year)
  if (civilOrdinal(lastAnniversary) > todayOrdinal) {
    lastAnniversary = observedDateForYear(original, current.year - 1)
  }
  if (!lastAnniversary || civilOrdinal(lastAnniversary) < originalOrdinal) {
    lastAnniversary = original
  }

  return {
    started: true,
    fullYears: lastAnniversary.year - original.year,
    daysAfterAnniversary: todayOrdinal - civilOrdinal(lastAnniversary),
    totalDays: todayOrdinal - originalOrdinal
  }
}

function kindMeta(kind) {
  return MEMORABLE_KIND_META[kind] ?? MEMORABLE_KIND_META.custom
}

function compareText(left, right) {
  const a = String(left ?? '')
  const b = String(right ?? '')
  return a < b ? -1 : a > b ? 1 : 0
}

export function upcomingMemorableDates(items = [], today = localDateParts(), limit = Infinity) {
  if (!Array.isArray(items) || !normalizedDate(today)) return []

  const result = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const original = normalizedDate(item)
    const occurrence = nextOccurrence(original, today)
    const progress = anniversaryProgress(original, today)
    if (!original || !occurrence || !progress) continue
    result.push({
      ...item,
      kindMeta: kindMeta(item.kind),
      occurrence,
      progress
    })
  }

  result.sort((left, right) => {
    const byDays = left.occurrence.daysUntil - right.occurrence.daysUntil
    if (byDays) return byDays
    const byOriginal = compareText(formatDateKey(left.date), formatDateKey(right.date))
    return byOriginal || compareText(left.id, right.id)
  })

  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : result.length
  return result.slice(0, count)
}

export function buildMonthGrid(year, month, items = [], today = localDateParts()) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return []
  if (!Number.isInteger(month) || month < 1 || month > 12) return []

  const current = normalizedDate(today)
  const firstOrdinal = civilOrdinal({ year, month, day: 1 })
  // 1970-01-01 was Thursday: Monday-first index 3.
  const firstWeekday = ((firstOrdinal + 3) % 7 + 7) % 7
  const startOrdinal = firstOrdinal - firstWeekday
  const dates = Array.from({ length: 42 }, (_, index) => dateFromCivilOrdinal(startOrdinal + index))
  if (dates.some(date => !date)) return []

  const eventsByDate = new Map()
  const years = new Set(dates.map(date => date.year))
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const original = normalizedDate(item)
      if (!original) continue
      for (const cellYear of years) {
        if (cellYear < original.year) continue
        const observed = observedDateForYear(original, cellYear)
        const key = formatDateKey(observed)
        if (!key) continue
        const event = {
          ...item,
          kindMeta: kindMeta(item.kind),
          anniversaryNumber: cellYear - original.year
        }
        const events = eventsByDate.get(key) ?? []
        events.push(event)
        eventsByDate.set(key, events)
      }
    }
  }

  for (const events of eventsByDate.values()) {
    events.sort((left, right) => {
      const byOriginal = compareText(formatDateKey(left.date), formatDateKey(right.date))
      return byOriginal || compareText(left.id, right.id)
    })
  }

  const todayKey = formatDateKey(current)
  return dates.map(date => {
    const key = formatDateKey(date)
    return {
      date,
      key,
      day: date.day,
      inMonth: date.year === year && date.month === month,
      isToday: key === todayKey,
      events: eventsByDate.get(key) ?? []
    }
  })
}

export function formatDateLong(value) {
  const date = normalizedDate(value)
  if (!date) return ''
  return `${date.day} ${RU_MONTHS[date.month - 1]} ${date.year}`
}
