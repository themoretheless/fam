export function formatDuration(ms) {
  if (ms <= 0) return 'сгорело'
  const totalMin = Math.floor(ms / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}д ${h}ч`
  if (h > 0) return `${h}ч ${m}м`
  if (totalMin >= 1) return `${m}м`
  return `${Math.ceil(ms / 1000)}с`
}

export const LEVEL_TITLES = ['Новичок', 'В деле', 'На подъёме', 'Мастер быта', 'Гуру порядка', 'Легенда чистоты']

/** Русские плюралы: 1/2-4/5+ */
export function ruPlural(n, one, few, many) {
  const x = Math.abs(Number(n) || 0)
  const n10 = x % 10
  const n100 = x % 100
  if (n10 === 1 && n100 !== 11) return one
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few
  return many
}

export function formatPointsWord(n) {
  return ruPlural(n, 'очко', 'очка', 'очков')
}

export function formatPoints(n) {
  const x = Number(n) || 0
  return `${x} ${formatPointsWord(x)}`
}

// xp может быть undefined/null (старый кэш) - считаем нулём. Отрицательное клампим в 0.
export function levelFromXp(xp) {
  const x = Math.max(Number(xp) || 0, 0)
  return 1 + Math.floor(Math.sqrt(x / 50))
}

export function levelTitle(level) {
  return LEVEL_TITLES[Math.min(level, 6) - 1] // 6+ -> 'Легенда чистоты'
}

// Доля [0,1) прогресса внутри текущего уровня.
export function levelProgress(xp) {
  const x = Math.max(Number(xp) || 0, 0)
  const lvl = levelFromXp(x)
  const prev = 50 * (lvl - 1) ** 2 // xp на старте текущего уровня
  const next = 50 * lvl ** 2 // xp для следующего уровня
  return Math.min((x - prev) / (next - prev), 1)
}

export function formatAgo(ts, now = Date.now()) {
  const ms = Math.max(now - ts, 0)
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} ${ruPlural(min, 'минуту', 'минуты', 'минут')} назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ${ruPlural(h, 'час', 'часа', 'часов')} назад`
  const d = Math.floor(h / 24)
  return `${d} ${ruPlural(d, 'день', 'дня', 'дней')} назад`
}
