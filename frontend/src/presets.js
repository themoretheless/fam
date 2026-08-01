/** Библиотека бытовых дел + size-пресеты + эвристики + last-defaults. */

export const SIZE_PRESETS = [
  { id: 'light', label: 'Лёгкое', emoji: '🪶', base_points: 5, hours: 12 },
  { id: 'normal', label: 'Обычное', emoji: '⚖️', base_points: 10, hours: 24 },
  { id: 'heavy', label: 'Тяжёлое', emoji: '🏋️', base_points: 30, hours: 48 }
]

export const PRESET_GROUPS = [
  { id: 'all', label: 'Все' },
  { id: 'кухня', label: 'Кухня' },
  { id: 'уборка', label: 'Уборка' },
  { id: 'дом', label: 'Дом' },
  { id: 'питомцы', label: 'Питомцы' },
  { id: 'покупки', label: 'Покупки' }
]

/** @type {{ id: string, title: string, emoji: string, base_points: number, hours: number, interval_hours?: number, repeat: boolean, tags: string[] }[]} */
export const PRESETS = [
  // кухня
  { id: 'k1', title: 'Помыть посуду', emoji: '🍽️', base_points: 10, hours: 6, repeat: false, tags: ['кухня'] },
  { id: 'k2', title: 'Протереть стол', emoji: '🧹', base_points: 5, hours: 12, repeat: false, tags: ['кухня'] },
  { id: 'k3', title: 'Вынести мусор', emoji: '🗑️', base_points: 10, hours: 6, repeat: false, tags: ['кухня', 'дом'] },
  { id: 'k4', title: 'Приготовить ужин', emoji: '🍳', base_points: 20, hours: 12, repeat: false, tags: ['кухня'] },
  { id: 'k5', title: 'Разобрать посудомойку', emoji: '🍽️', base_points: 10, hours: 12, repeat: false, tags: ['кухня'] },
  { id: 'k6', title: 'Протереть плиту', emoji: '🔥', base_points: 10, hours: 24, repeat: false, tags: ['кухня'] },
  // уборка
  { id: 'c1', title: 'Пропылесосить', emoji: '🧹', base_points: 20, hours: 24, repeat: false, tags: ['уборка'] },
  { id: 'c2', title: 'Помыть полы', emoji: '🧽', base_points: 20, hours: 24, repeat: false, tags: ['уборка'] },
  { id: 'c3', title: 'Заправить постель', emoji: '🛏️', base_points: 10, hours: 12, repeat: false, tags: ['уборка'] },
  { id: 'c4', title: 'Почистить ванну', emoji: '🛁', base_points: 20, hours: 48, repeat: false, tags: ['уборка'] },
  { id: 'c5', title: 'Протереть пыль', emoji: '🪶', base_points: 10, hours: 24, repeat: false, tags: ['уборка'] },
  { id: 'c6', title: 'Стирка', emoji: '🧺', base_points: 15, hours: 24, repeat: false, tags: ['уборка'] },
  { id: 'c7', title: 'Развесить бельё', emoji: '👕', base_points: 10, hours: 12, repeat: false, tags: ['уборка'] },
  // дом
  { id: 'h1', title: 'Полить цветы', emoji: '🪴', base_points: 10, hours: 24, repeat: true, tags: ['дом'] },
  { id: 'h2', title: 'Заменить лампочку', emoji: '💡', base_points: 10, hours: 48, repeat: false, tags: ['дом'] },
  { id: 'h3', title: 'Оплатить счета', emoji: '💳', base_points: 15, hours: 48, repeat: false, tags: ['дом'] },
  { id: 'h4', title: 'Разобрать почту', emoji: '📬', base_points: 5, hours: 24, repeat: false, tags: ['дом'] },
  { id: 'h5', title: 'Помыть машину', emoji: '🚗', base_points: 30, hours: 48, repeat: false, tags: ['дом'] },
  // питомцы
  { id: 'p1', title: 'Выгулять собаку', emoji: '🐕', base_points: 15, hours: 6, repeat: true, tags: ['питомцы'] },
  { id: 'p2', title: 'Покормить питомца', emoji: '🐾', base_points: 10, hours: 12, repeat: true, tags: ['питомцы'] },
  { id: 'p3', title: 'Почистить лоток', emoji: '🐈', base_points: 10, hours: 24, repeat: true, tags: ['питомцы'] },
  // покупки
  { id: 's1', title: 'Закупка продуктов', emoji: '🛒', base_points: 20, hours: 24, repeat: false, tags: ['покупки'] },
  { id: 's2', title: 'Купить хлеб', emoji: '🍞', base_points: 5, hours: 6, repeat: false, tags: ['покупки'] },
  { id: 's3', title: 'Аптека', emoji: '💊', base_points: 15, hours: 24, repeat: false, tags: ['покупки'] },
  { id: 's4', title: 'Забрать посылку', emoji: '📦', base_points: 10, hours: 48, repeat: false, tags: ['покупки'] }
]

const DEFAULTS_KEY = 'fam-add-defaults'

export function positiveFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** Only an interval different from the fuse starts in custom mode. */
export function resolvePresetInterval(preset) {
  const hours = positiveFiniteNumber(preset?.hours)
  const explicitInterval = positiveFiniteNumber(preset?.interval_hours)
  return {
    interval_hours: explicitInterval ?? hours,
    custom: explicitInterval !== null && explicitInterval !== hours
  }
}

export function isCustomInterval(intervalHours, hours) {
  const interval = positiveFiniteNumber(intervalHours)
  const fuse = positiveFiniteNumber(hours)
  return interval !== null && fuse !== null && interval !== fuse
}

export function normalizeAddDefaults(value) {
  if (!value || typeof value !== 'object') return null
  const hours = positiveFiniteNumber(value.hours)
  return {
    emoji: typeof value.emoji === 'string' ? value.emoji : null,
    base_points: positiveFiniteNumber(value.base_points),
    hours,
    // Defaults written before interval_hours existed repeat on their fuse cadence.
    interval_hours: positiveFiniteNumber(value.interval_hours) ?? hours,
    repeat: !!value.repeat
  }
}

export function loadAddDefaults() {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY)
    if (!raw) return null
    return normalizeAddDefaults(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveAddDefaults(partial) {
  try {
    const normalized = normalizeAddDefaults(partial)
    if (normalized) localStorage.setItem(DEFAULTS_KEY, JSON.stringify(normalized))
  } catch {
    // private mode
  }
}

/** Эвристики по подстроке title (нижний регистр). Первый match побеждает. */
const HEURISTICS = [
  { re: /посуд|тарелк|кастрюл|вилк|ложк/, emoji: '🍽️', base_points: 10, hours: 6 },
  { re: /мусор|вынест/, emoji: '🗑️', base_points: 10, hours: 6 },
  { re: /пылесос|уборк|пол(?!к)/, emoji: '🧹', base_points: 20, hours: 24 },
  { re: /магазин|купить|продукт|закуп/, emoji: '🛒', base_points: 20, hours: 24 },
  { re: /собак|кошк|питом|выгул|лоток/, emoji: '🐕', base_points: 15, hours: 12 },
  { re: /стирк|стиральн|бель/, emoji: '🧺', base_points: 15, hours: 24 },
  { re: /цвет|полит|растен/, emoji: '🪴', base_points: 10, hours: 24 },
  { re: /ванн|душ|туалет|унитаз/, emoji: '🛁', base_points: 20, hours: 48 },
  { re: /машин|авто/, emoji: '🚗', base_points: 30, hours: 48 },
  { re: /ремонт|сборк|тяжёл/, emoji: '🔧', base_points: 30, hours: 48 },
  { re: /пыл/, emoji: '🪶', base_points: 10, hours: 24 },
  { re: /готов|ужин|завтрак|обед/, emoji: '🍳', base_points: 20, hours: 12 }
]

export function matchHeuristic(title) {
  const t = String(title || '').toLowerCase()
  if (!t) return null
  for (const h of HEURISTICS) {
    if (h.re.test(t)) {
      return {
        emoji: h.emoji,
        base_points: h.base_points,
        hours: h.hours
      }
    }
  }
  return null
}

/** Filter by group tag and case-insensitive title substring. */
export function filterPresets(list, q, groupId = 'all') {
  let out = list
  if (groupId && groupId !== 'all') {
    out = out.filter(p => Array.isArray(p.tags) && p.tags.includes(groupId))
  }
  const query = String(q ?? '')
    .trim()
    .toLowerCase()
  if (!query) return out
  return out.filter(p => String(p?.title ?? '').toLowerCase().includes(query))
}

/** Family-shelf search is deliberately independent from built-in category tags. */
export function filterFamilyShelf(list, q) {
  const items = Array.isArray(list) ? list : []
  const query = String(q ?? '')
    .trim()
    .toLocaleLowerCase('ru')
  if (!query) return items.slice()
  return items.filter(item =>
    String(item?.title ?? '')
      .toLocaleLowerCase('ru')
      .includes(query)
  )
}

/** Build a finite, positive shelf payload without leaking UI-only interval state. */
export function buildShelfPayload(draft) {
  const hours = positiveFiniteNumber(draft?.hours) ?? 24
  const repeat = !!draft?.repeat
  const payload = {
    title: String(draft?.title ?? '').trim(),
    emoji:
      typeof draft?.emoji === 'string' && draft.emoji.trim()
        ? draft.emoji.trim()
        : '🧺',
    base_points: positiveFiniteNumber(draft?.base_points) ?? 10,
    hours,
    repeat
  }

  if (repeat && draft?.interval_custom) {
    payload.interval_hours = positiveFiniteNumber(draft?.interval_hours) ?? hours
  }

  return payload
}
