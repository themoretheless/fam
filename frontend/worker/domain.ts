import type {
  Achievement,
  ClaimRequest,
  ClaimResponse,
  Db,
  FamEvent,
  FamilyShelfItem,
  IdFactory,
  MemorableDate,
  MemorableDateKind,
  MemorableDateRequest,
  NewTaskRequest,
  Player,
  ReactionRequest,
  RenameRequest,
  StateResponse,
  Task
} from './types.js'

const MAX_EVENTS = 30
const MAX_FAMILY_SHELF_ITEMS = 50
const MAX_MEMORABLE_DATES = 100
const MAX_MULTIPLIER = 3
const U32_MAX = 0xffff_ffff
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface NormalizedTaskTemplate {
  title: string
  emoji: string
  base_points: number
  hours: number
  repeat: boolean
  interval_hours: number | null
}

interface ClaimAchievementRule {
  key: string
  title: string
  emoji: string
  matches: (context: ClaimAchievementContext) => boolean
}

interface ClaimAchievementContext {
  done: number
  doneToday: number
  xp: number
  taskDeadline: number
  now: number
  comboMult: number
}

const CLAIM_ACHIEVEMENT_RULES: ClaimAchievementRule[] = [
  {
    key: 'first_task',
    title: 'Первое дело',
    emoji: '🎉',
    matches: context => context.done >= 1
  },
  {
    key: 'ten_tasks',
    title: 'Десяточка',
    emoji: '🔟',
    matches: context => context.done >= 10
  },
  {
    key: 'hundred_xp',
    title: 'Сотня',
    emoji: '💯',
    matches: context => context.xp >= 100
  },
  {
    key: 'five_hundred_xp',
    title: 'Пятисотка',
    emoji: '🚀',
    matches: context => context.xp >= 500
  },
  {
    key: 'five_a_day',
    title: 'Пятидневка',
    emoji: '🖐️',
    matches: context => context.doneToday >= 5
  },
  {
    key: 'firefighter',
    title: 'Пожарный',
    emoji: '🚒',
    matches: context => context.taskDeadline - context.now < MINUTE_MS
  },
  {
    key: 'night_owl',
    title: 'Сова',
    emoji: '🦉',
    matches: context => new Date(context.now).getUTCHours() < 5
  },
  {
    key: 'combo_master',
    title: 'Комбо-мастер',
    emoji: '⚡',
    matches: context => context.comboMult >= 1.5
  }
]

const defaultIdFactory: IdFactory = () => globalThis.crypto.randomUUID()

const clonePlayer = (player: Player): Player => ({ ...player })
const cloneTask = (task: Task): Task => ({ ...task })
const cloneEvent = (event: FamEvent): FamEvent => ({
  ...event,
  reactions: event.reactions.map(reaction => ({ ...reaction }))
})
const cloneAchievement = (achievement: Achievement): Achievement => ({ ...achievement })
const cloneShelfItem = (item: FamilyShelfItem): FamilyShelfItem => ({ ...item })
const cloneMemorableDate = (item: MemorableDate): MemorableDate => ({ ...item })

function incrementU32(value: number, amount = 1): number {
  return Math.min(U32_MAX, value + amount)
}

function durationMs(hours: number): number {
  // Rust builds chrono::Duration from a truncated whole number of seconds.
  return Math.trunc(hours * 3600) * 1000
}

function sanitizeText(value: string, maxChars: number): string {
  const cleaned: string[] = []
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue
    if (
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    ) {
      continue
    }
    cleaned.push(char)
  }
  return cleaned.slice(0, maxChars).join('').trim()
}

function numericTemplateError(): never {
  throw new ApiError(422, 'Числовые поля должны быть конечными')
}

function boundedHours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) numericTemplateError()
  return Math.min(24 * 30, Math.max(0.05, value))
}

function normalizeTaskTemplate(request: NewTaskRequest): NormalizedTaskTemplate {
  if (!request || typeof request.title !== 'string') {
    throw new ApiError(422, 'Название должно быть от 1 до 80 символов')
  }
  const title = sanitizeText(request.title, 81)
  if (!title || Array.from(title).length > 80) {
    throw new ApiError(422, 'Название должно быть от 1 до 80 символов')
  }

  const rawEmoji = request.emoji ?? '📌'
  if (typeof rawEmoji !== 'string') {
    throw new ApiError(422, 'Название должно быть от 1 до 80 символов')
  }
  const sanitizedEmoji = sanitizeText(rawEmoji, 8)
  const emoji = Array.from(rawEmoji).length > 8 || !sanitizedEmoji ? '📌' : sanitizedEmoji

  const rawPoints = request.base_points ?? 10
  if (typeof rawPoints !== 'number' || !Number.isSafeInteger(rawPoints)) numericTemplateError()
  const basePoints = Math.min(1000, Math.max(1, rawPoints))

  const hours = boundedHours(request.hours ?? 24)
  if (request.repeat != null && typeof request.repeat !== 'boolean') {
    throw new ApiError(422, 'Некорректное значение repeat')
  }
  const repeat = request.repeat ?? false
  // Rust validates/clamps interval even when repeat=false, and only then clears it.
  const normalizedInterval =
    request.interval_hours == null ? null : boundedHours(request.interval_hours)
  const intervalHours = repeat ? normalizedInterval : null

  return {
    title,
    emoji,
    base_points: basePoints,
    hours,
    repeat,
    interval_hours: intervalHours
  }
}

function normalizeMemorableDate(request: MemorableDateRequest): Omit<MemorableDate, 'id'> {
  if (!request || typeof request.title !== 'string') {
    throw new ApiError(422, 'Название должно быть от 1 до 80 символов')
  }
  const title = sanitizeText(request.title, 81)
  if (!title || Array.from(title).length > 80) {
    throw new ApiError(422, 'Название должно быть от 1 до 80 символов')
  }
  if (typeof request.date !== 'string' || !isExactDate(request.date)) {
    throw new ApiError(422, 'Дата должна существовать и иметь формат YYYY-MM-DD')
  }
  if (!isMemorableDateKind(request.kind)) {
    throw new ApiError(422, 'Тип даты: anniversary, meeting, birthday или custom')
  }
  return { title, date: request.date, kind: request.kind }
}

function isMemorableDateKind(value: unknown): value is MemorableDateKind {
  return (
    value === 'anniversary' ||
    value === 'meeting' ||
    value === 'birthday' ||
    value === 'custom'
  )
}

function isExactDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

function sameUtcDate(left: number, right: number): boolean {
  const a = new Date(left)
  const b = new Date(right)
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

function isoWeekKey(now: number): string {
  const source = new Date(now)
  const date = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate())
  )
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const isoYear = date.getUTCFullYear()
  const yearStart = Date.UTC(isoYear, 0, 1)
  const week = Math.ceil((Math.floor((date.getTime() - yearStart) / DAY_MS) + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

function pointsWord(points: number): string {
  const absolute = Math.abs(points)
  const lastDigit = absolute % 10
  const lastTwoDigits = absolute % 100
  if (lastDigit === 1 && lastTwoDigits !== 11) return 'очко'
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwoDigits >= 12 && lastTwoDigits <= 14)) {
    return 'очка'
  }
  return 'очков'
}

function formatWaitLabel(from: number, to: number): string {
  const minutes = Math.max(0, Math.trunc((to - from) / MINUTE_MS))
  return minutes >= 60 ? `через ${Math.ceil(minutes / 60)}ч` : `через ${minutes}м`
}

function pushEvent(db: Db, kind: string, text: string, at: number, idFactory: IdFactory): void {
  db.events.unshift({
    id: idFactory(),
    kind,
    text,
    at,
    reactions: []
  })
  db.events.splice(MAX_EVENTS)
}

function currentPoints(task: Task, now: number): number {
  const total = Math.max(task.deadline - task.created_at, 1)
  const elapsed = Math.min(total, Math.max(0, now - task.created_at))
  const multiplier = 1 + (MAX_MULTIPLIER - 1) * (elapsed / total)
  return Math.round(task.base_points * multiplier)
}

function comboFor(db: Db, playerId: string, now: number): [number, number] {
  const cutoff = now - HOUR_MS
  const prior = db.tasks.filter(
    task =>
      task.status === 'done' &&
      task.claimed_by === playerId &&
      task.finished_at != null &&
      task.finished_at >= cutoff
  ).length
  const count = prior + 1
  const multiplier = count >= 3 ? 1.5 : count === 2 ? 1.25 : 1
  return [count, multiplier]
}

function taskIntervalHours(task: Task): number | null {
  const interval = task.interval_hours ?? task.repeat_hours
  return interval != null && interval > 0 ? interval : null
}

function taskFuseHours(task: Task): number {
  if (task.fuse_hours != null && task.fuse_hours > 0) return task.fuse_hours
  const span = Math.max(task.deadline - task.created_at, 1) / HOUR_MS
  if (span > 0) return span
  return taskIntervalHours(task) ?? 24
}

function scheduleRespawn(task: Task, now: number, idFactory: IdFactory): Task | null {
  const interval = taskIntervalHours(task)
  if (interval == null) return null
  const fuse = taskFuseHours(task)
  const appearAt = now + durationMs(interval)
  return {
    id: idFactory(),
    title: task.title,
    emoji: task.emoji,
    base_points: task.base_points,
    created_at: appearAt,
    deadline: appearAt + durationMs(fuse),
    status: 'scheduled',
    claimed_by: null,
    awarded_points: null,
    finished_at: null,
    repeat_hours: interval,
    interval_hours: interval,
    fuse_hours: fuse,
    appear_at: appearAt
  }
}

function spawnDue(db: Db, now: number, idFactory: IdFactory): number {
  const titles: string[] = []
  for (const task of db.tasks) {
    if (task.status !== 'scheduled' || task.appear_at == null || task.appear_at > now) continue
    const fuse =
      task.fuse_hours != null && task.fuse_hours > 0
        ? task.fuse_hours
        : (taskIntervalHours(task) ?? 24)
    task.status = 'open'
    task.created_at = now
    task.deadline = now + durationMs(fuse)
    task.appear_at = null
    task.claimed_by = null
    task.awarded_points = null
    task.finished_at = null
    titles.push(task.title)
  }
  for (const title of titles) {
    pushEvent(db, 'repeat', `🔁 «${title}» снова в очереди`, now, idFactory)
  }
  return titles.length
}

function award(
  db: Db,
  playerId: string,
  key: string,
  title: string,
  emoji: string,
  now: number,
  idFactory: IdFactory
): Achievement | null {
  if (db.achievements.some(item => item.player_id === playerId && item.key === key)) return null
  const name = db.players.find(player => player.id === playerId)?.name ?? ''
  pushEvent(db, 'achievement', `🏅 ${name} получает ачивку: ${emoji} «${title}»`, now, idFactory)
  const achievement: Achievement = {
    id: idFactory(),
    player_id: playerId,
    key,
    title,
    emoji,
    at: now
  }
  db.achievements.push(achievement)
  return achievement
}

function checkClaimAchievements(
  db: Db,
  playerId: string,
  now: number,
  taskDeadline: number,
  comboMult: number,
  idFactory: IdFactory
): Achievement[] {
  const doneTasks = db.tasks.filter(
    task => task.status === 'done' && task.claimed_by === playerId
  )
  const context: ClaimAchievementContext = {
    done: doneTasks.length,
    doneToday: doneTasks.filter(
      task => task.finished_at != null && sameUtcDate(task.finished_at, now)
    ).length,
    xp: db.players.find(player => player.id === playerId)?.xp ?? 0,
    taskDeadline,
    now,
    comboMult
  }
  const added: Achievement[] = []
  for (const rule of CLAIM_ACHIEVEMENT_RULES) {
    if (!rule.matches(context)) continue
    const achievement = award(
      db,
      playerId,
      rule.key,
      rule.title,
      rule.emoji,
      now,
      idFactory
    )
    if (achievement) added.push(cloneAchievement(achievement))
  }
  return added
}

function checkWeekRollover(db: Db, now: number, idFactory: IdFactory): boolean {
  const current = isoWeekKey(now)
  if (db.week_key === current) return false
  if (!db.week_key) {
    db.week_key = current
    return true
  }

  const p1Score = db.players.find(player => player.id === 'p1')?.score ?? 0
  const p2Score = db.players.find(player => player.id === 'p2')?.score ?? 0
  const winner = p1Score > p2Score ? 'p1' : p2Score > p1Score ? 'p2' : null
  const closed = db.week_key
  db.seasons.push({
    week_key: closed,
    p1_score: p1Score,
    p2_score: p2Score,
    winner
  })
  const text = winner
    ? `🏁 Неделя закрыта: 👑 ${db.players.find(player => player.id === winner)?.name ?? ''} выигрывает сезон ${closed}!`
    : `🏁 Неделя закрыта: ничья в сезоне ${closed}!`
  pushEvent(db, 'season', text, now, idFactory)
  if (winner) award(db, winner, 'week_winner', 'Чемпион недели', '👑', now, idFactory)

  if (db.week_burns === 0 && db.week_claims > 0) {
    const playerIds = db.players.map(player => player.id)
    for (const playerId of playerIds) {
      award(db, playerId, 'zero_fires', 'Ноль пожаров', '🛡️', now, idFactory)
    }
    pushEvent(db, 'achievement', `🛡️ Идеальная неделя ${closed}: ни одного пожара!`, now, idFactory)
  }
  for (const player of db.players) player.score = 0
  db.week_key = current
  db.week_burns = 0
  db.week_claims = 0
  return true
}

function burnExpired(
  db: Db,
  now: number,
  belongsToPhase: (task: Task) => boolean,
  idFactory: IdFactory
): boolean {
  const burned: Array<{ title: string; penalty: number }> = []
  const scheduled: Task[] = []
  for (const task of db.tasks) {
    if (task.status !== 'open' || task.deadline > now || !belongsToPhase(task)) continue
    task.status = 'burned'
    task.finished_at = task.deadline
    burned.push({ title: task.title, penalty: Math.trunc((task.base_points + 1) / 2) })
    const fresh = scheduleRespawn(task, now, idFactory)
    if (fresh) scheduled.push(fresh)
  }
  if (!burned.length) return false

  db.week_burns = incrementU32(db.week_burns, burned.length)
  for (const item of burned) {
    for (const player of db.players) player.score = Math.max(0, player.score - item.penalty)
    pushEvent(
      db,
      'burn',
      `🔥 «${item.title}» сгорело: -${item.penalty} ${pointsWord(item.penalty)} обоим`,
      now,
      idFactory
    )
  }
  for (const task of scheduled) {
    const when = task.appear_at == null ? 'скоро' : formatWaitLabel(now, task.appear_at)
    pushEvent(db, 'repeat', `🔁 «${task.title}» вернётся ${when}`, now, idFactory)
    db.tasks.push(task)
  }
  return true
}

function sameTemplate(left: FamilyShelfItem, right: FamilyShelfItem): boolean {
  return (
    left.title === right.title &&
    left.emoji === right.emoji &&
    left.base_points === right.base_points &&
    left.hours === right.hours &&
    left.repeat === right.repeat &&
    left.interval_hours === right.interval_hours
  )
}

function sameMemorableDate(left: MemorableDate, right: MemorableDate): boolean {
  return left.title === right.title && left.date === right.date && left.kind === right.kind
}

export function defaultDb(): Db {
  return {
    players: [
      {
        id: 'p1',
        name: 'Игрок 1',
        avatar: '🦊',
        score: 0,
        xp: 0,
        last_claim_at: null,
        comeback_week_key: ''
      },
      {
        id: 'p2',
        name: 'Игрок 2',
        avatar: '🐻‍❄️',
        score: 0,
        xp: 0,
        last_claim_at: null,
        comeback_week_key: ''
      }
    ],
    tasks: [],
    events: [],
    week_key: '',
    seasons: [],
    achievements: [],
    week_burns: 0,
    week_claims: 0,
    family_shelf: [],
    memorable_dates: []
  }
}

export function sweep(
  db: Db,
  now = Date.now(),
  idFactory: IdFactory = defaultIdFactory
): boolean {
  const currentWeek = isoWeekKey(now)
  const crossesWeek = Boolean(db.week_key) && db.week_key !== currentWeek
  const burnedBefore = crossesWeek
    ? burnExpired(db, now, task => isoWeekKey(task.deadline) !== currentWeek, idFactory)
    : false
  const rolled = checkWeekRollover(db, now, idFactory)
  const burnedAfter = crossesWeek
    ? burnExpired(db, now, task => isoWeekKey(task.deadline) === currentWeek, idFactory)
    : burnExpired(db, now, () => true, idFactory)
  const spawned = spawnDue(db, now, idFactory) > 0
  return burnedBefore || rolled || burnedAfter || spawned
}

export function stateResponse(db: Db, now = Date.now()): StateResponse {
  const tasks = db.tasks
    .filter(task => task.status === 'open')
    .map(cloneTask)
    .sort((left, right) => left.deadline - right.deadline)
  const history = db.tasks
    .filter(task => task.status === 'done' || task.status === 'burned')
    .map(cloneTask)
    .sort((left, right) => {
      if (left.finished_at == null && right.finished_at == null) return 0
      if (left.finished_at == null) return 1
      if (right.finished_at == null) return -1
      return right.finished_at - left.finished_at
    })
    .slice(0, 200)
  return {
    players: db.players.map(clonePlayer),
    tasks,
    events: db.events.map(cloneEvent),
    week_key: db.week_key,
    seasons: db.seasons.map(item => ({ ...item })).reverse().slice(0, 8),
    achievements: db.achievements.map(cloneAchievement),
    history,
    family_shelf: db.family_shelf.map(cloneShelfItem),
    memorable_dates: db.memorable_dates.map(cloneMemorableDate),
    server_now: now
  }
}

export function createTask(
  db: Db,
  request: NewTaskRequest,
  now = Date.now(),
  idFactory: IdFactory = defaultIdFactory
): Task {
  const normalized = normalizeTaskTemplate(request)
  const interval = normalized.repeat
    ? (normalized.interval_hours ?? normalized.hours)
    : null
  const task: Task = {
    id: idFactory(),
    title: normalized.title,
    emoji: normalized.emoji,
    base_points: normalized.base_points,
    created_at: now,
    deadline: now + durationMs(normalized.hours),
    status: 'open',
    claimed_by: null,
    awarded_points: null,
    finished_at: null,
    repeat_hours: interval,
    interval_hours: interval,
    fuse_hours: normalized.hours,
    appear_at: null
  }
  pushEvent(db, 'new', `${task.emoji} Новое дело: «${task.title}»`, now, idFactory)
  db.tasks.push(task)
  return cloneTask(task)
}

export function claimTask(
  db: Db,
  id: string,
  request: ClaimRequest,
  now = Date.now(),
  idFactory: IdFactory = defaultIdFactory
): ClaimResponse {
  if (!request || !db.players.some(player => player.id === request.player_id)) {
    throw new ApiError(422, 'Неизвестный игрок')
  }
  const task = db.tasks.find(item => item.id === id)
  if (!task) throw new ApiError(404, 'Дело не найдено')
  if (task.status !== 'open') {
    throw new ApiError(
      409,
      task.status === 'burned' ? 'Поздно: дело уже сгорело' : 'Дело уже разобрано'
    )
  }

  const points = currentPoints(task, now)
  const [comboCount, comboMult] = comboFor(db, request.player_id, now)
  const awarded = Math.round(points * comboMult)
  const title = task.title
  const emoji = task.emoji
  const deadline = task.deadline
  task.status = 'done'
  task.claimed_by = request.player_id
  task.awarded_points = awarded
  task.finished_at = now

  const week = db.week_key || isoWeekKey(now)
  const player = db.players.find(item => item.id === request.player_id)!
  let comeback = 0
  if (
    player.last_claim_at != null &&
    now - player.last_claim_at >= 48 * HOUR_MS &&
    player.comeback_week_key !== week
  ) {
    comeback = 5
    player.comeback_week_key = week
  }
  player.last_claim_at = now
  player.score += awarded + comeback
  player.xp += awarded + comeback
  db.week_claims = incrementU32(db.week_claims)

  let eventText = `${player.avatar} ${player.name}: ${emoji} «${title}» готово, +${awarded} ${pointsWord(awarded)}`
  if (comboCount >= 2) eventText += ` 🔥 КОМБО ×${comboMult}`
  if (comeback > 0) {
    eventText += ` · камбэк +${comeback}`
    pushEvent(
      db,
      'comeback',
      `💪 ${player.name} возвращается: камбэк +${comeback}`,
      now,
      idFactory
    )
  }
  pushEvent(db, 'done', eventText, now, idFactory)

  const fresh = scheduleRespawn(task, now, idFactory)
  if (fresh) {
    const when = fresh.appear_at == null ? 'скоро' : formatWaitLabel(now, fresh.appear_at)
    pushEvent(db, 'repeat', `🔁 «${fresh.title}» вернётся ${when}`, now, idFactory)
    db.tasks.push(fresh)
  }
  const newAchievements = checkClaimAchievements(
    db,
    request.player_id,
    now,
    deadline,
    comboMult,
    idFactory
  )
  return {
    points: awarded + comeback,
    task_points: awarded,
    comeback,
    players: db.players.map(clonePlayer),
    combo_count: comboCount,
    combo_mult: comboMult,
    new_achievements: newAchievements
  }
}

export function deleteTask(db: Db, id: string): { ok: true } {
  const index = db.tasks.findIndex(task => task.id === id && task.status === 'open')
  if (index < 0) throw new ApiError(404, 'Дело не найдено')
  db.tasks.splice(index, 1)
  return { ok: true }
}

export function createShelfItem(
  db: Db,
  request: NewTaskRequest,
  idFactory: IdFactory = defaultIdFactory
): FamilyShelfItem {
  const normalized = normalizeTaskTemplate(request)
  const item: FamilyShelfItem = {
    id: idFactory(),
    ...normalized
  }
  if (db.family_shelf.length >= MAX_FAMILY_SHELF_ITEMS) {
    throw new ApiError(409, 'На семейной полке уже 50 шаблонов')
  }
  if (db.family_shelf.some(existing => sameTemplate(existing, item))) {
    throw new ApiError(409, 'Такой шаблон уже есть на полке')
  }
  db.family_shelf.unshift(item)
  return cloneShelfItem(item)
}

export function updateShelfItem(
  db: Db,
  id: string,
  request: NewTaskRequest
): FamilyShelfItem {
  const normalized = normalizeTaskTemplate(request)
  const position = db.family_shelf.findIndex(item => item.id === id)
  if (position < 0) throw new ApiError(404, 'Шаблон не найден')
  const replacement: FamilyShelfItem = { id, ...normalized }
  if (
    db.family_shelf.some(
      (existing, index) => index !== position && sameTemplate(existing, replacement)
    )
  ) {
    throw new ApiError(409, 'Такой шаблон уже есть на полке')
  }
  db.family_shelf[position] = replacement
  return cloneShelfItem(replacement)
}

export function deleteShelfItem(db: Db, id: string): { ok: true } {
  const position = db.family_shelf.findIndex(item => item.id === id)
  if (position < 0) throw new ApiError(404, 'Шаблон не найден')
  db.family_shelf.splice(position, 1)
  return { ok: true }
}

export function createMemorableDate(
  db: Db,
  request: MemorableDateRequest,
  idFactory: IdFactory = defaultIdFactory
): MemorableDate {
  const normalized = normalizeMemorableDate(request)
  const item: MemorableDate = { id: idFactory(), ...normalized }
  if (db.memorable_dates.length >= MAX_MEMORABLE_DATES) {
    throw new ApiError(409, 'В семейном календаре уже 100 памятных дат')
  }
  if (db.memorable_dates.some(existing => sameMemorableDate(existing, item))) {
    throw new ApiError(409, 'Такая памятная дата уже есть')
  }
  db.memorable_dates.unshift(item)
  return cloneMemorableDate(item)
}

export function updateMemorableDate(
  db: Db,
  id: string,
  request: MemorableDateRequest
): MemorableDate {
  const normalized = normalizeMemorableDate(request)
  const position = db.memorable_dates.findIndex(item => item.id === id)
  if (position < 0) throw new ApiError(404, 'Памятная дата не найдена')
  const replacement: MemorableDate = { id, ...normalized }
  if (
    db.memorable_dates.some(
      (existing, index) => index !== position && sameMemorableDate(existing, replacement)
    )
  ) {
    throw new ApiError(409, 'Такая памятная дата уже есть')
  }
  db.memorable_dates[position] = replacement
  return cloneMemorableDate(replacement)
}

export function deleteMemorableDate(db: Db, id: string): { ok: true } {
  const position = db.memorable_dates.findIndex(item => item.id === id)
  if (position < 0) throw new ApiError(404, 'Памятная дата не найдена')
  db.memorable_dates.splice(position, 1)
  return { ok: true }
}

export function renamePlayer(db: Db, id: string, request: RenameRequest): { players: Player[] } {
  if (!request || typeof request.name !== 'string') {
    throw new ApiError(422, 'Имя должно быть от 1 до 24 символов')
  }
  // This intentionally mirrors Rust: sanitize truncates to 24 before validation.
  const name = sanitizeText(request.name, 24)
  if (!name || Array.from(name).length > 24) {
    throw new ApiError(422, 'Имя должно быть от 1 до 24 символов')
  }
  const player = db.players.find(item => item.id === id)
  if (!player) throw new ApiError(404, 'Игрок не найден')
  player.name = name
  return { players: db.players.map(clonePlayer) }
}

export function reactEvent(db: Db, id: string, request: ReactionRequest): FamEvent {
  if (!request || !['🙏', '❤️', '🔥'].includes(request.emoji)) {
    throw new ApiError(422, 'Некорректная реакция')
  }
  if (request.player_id !== 'p1' && request.player_id !== 'p2') {
    throw new ApiError(422, 'Неизвестный игрок')
  }
  const event = db.events.find(item => item.id === id)
  if (!event) throw new ApiError(404, 'Событие не найдено')
  if (event.kind !== 'done') {
    throw new ApiError(409, 'Реакция только на выполненные дела')
  }
  const existing = event.reactions.find(reaction => reaction.player_id === request.player_id)
  if (existing) existing.emoji = request.emoji
  else event.reactions.push({ player_id: request.player_id, emoji: request.emoji })
  return cloneEvent(event)
}
