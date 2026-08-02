import { describe, expect, it } from 'vitest'
import {
  ApiError,
  claimTask,
  createMemorableDate,
  createShelfItem,
  createTask,
  defaultDb,
  deleteMemorableDate,
  deleteShelfItem,
  deleteTask,
  reactEvent,
  renamePlayer,
  stateResponse,
  sweep,
  updateMemorableDate,
  updateShelfItem
} from './domain.js'
import type { Db, IdFactory, Task } from './types.js'

const at = (value: string): number => Date.parse(value)

function ids(prefix = 'id'): IdFactory {
  let next = 0
  return () => `${prefix}-${++next}`
}

function expectApiError(action: () => unknown, status: number, message: string): void {
  try {
    action()
    throw new Error('expected ApiError')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(status)
    expect((error as ApiError).message).toBe(message)
  }
}

function addOpenTask(
  db: Db,
  overrides: Partial<Task> = {},
  idFactory: IdFactory = ids('task')
): Task {
  const now = overrides.created_at ?? at('2026-01-07T12:00:00.000Z')
  const task = createTask(
    db,
    {
      title: overrides.title ?? 'Тестовое дело',
      emoji: overrides.emoji ?? '🧪',
      base_points: overrides.base_points ?? 10,
      hours: 1,
      repeat: false
    },
    now,
    idFactory
  )
  Object.assign(db.tasks.at(-1)!, overrides)
  return db.tasks.at(-1)!
}

describe('default state and task templates', () => {
  it('starts with two placeholder players and otherwise empty state', () => {
    const db = defaultDb()
    expect(db.players.map(player => player.name)).toEqual(['Игрок 1', 'Игрок 2'])
    expect(db.players.every(player => player.score === 0 && player.xp === 0)).toBe(true)
    expect(db.tasks).toEqual([])
    expect(db.events).toEqual([])
    expect(db.week_key).toBe('')
    expect(db.family_shelf).toEqual([])
    expect(db.memorable_dates).toEqual([])
  })

  it('sanitizes, clamps and preserves millisecond timestamp wire format', () => {
    const db = defaultDb()
    const now = at('2026-01-07T12:34:56.789Z')
    const task = createTask(
      db,
      {
        title: ' \u202e Полить\u0000 цветы ',
        emoji: '',
        base_points: 2000,
        hours: 0,
        repeat: true
      },
      now,
      ids()
    )
    expect(task).toMatchObject({
      title: 'Полить цветы',
      emoji: '📌',
      base_points: 1000,
      created_at: now,
      deadline: now + 180_000,
      status: 'open',
      repeat_hours: 0.05,
      interval_hours: 0.05,
      fuse_hours: 0.05,
      appear_at: null
    })
    expect(db.events[0]).toMatchObject({ kind: 'new', at: now })
  })

  it('rejects long/empty titles and non-finite numbers, even for a disabled repeat', () => {
    const db = defaultDb()
    expectApiError(
      () => createTask(db, { title: 'x'.repeat(81) }, 0, ids()),
      422,
      'Название должно быть от 1 до 80 символов'
    )
    expectApiError(
      () => createTask(db, { title: '\u200b\u0000' }, 0, ids()),
      422,
      'Название должно быть от 1 до 80 символов'
    )
    expectApiError(
      () =>
        createTask(
          db,
          { title: 'Дело', repeat: false, interval_hours: Number.POSITIVE_INFINITY },
          0,
          ids()
        ),
      422,
      'Числовые поля должны быть конечными'
    )
    expect(db.tasks).toHaveLength(0)
  })

  it('deletes only open tasks', () => {
    const db = defaultDb()
    const open = addOpenTask(db)
    expect(deleteTask(db, open.id)).toEqual({ ok: true })
    expect(db.tasks).toHaveLength(0)

    const done = addOpenTask(db, { status: 'done' }, ids('done'))
    expectApiError(() => deleteTask(db, done.id), 404, 'Дело не найдено')
  })
})

describe('claim scoring and achievements', () => {
  it('uses linear points, combo multipliers and awards achievements once', () => {
    const db = defaultDb()
    db.week_key = '2026-W02'
    const now = at('2026-01-07T12:00:00.000Z')
    const idFactory = ids('claim')
    const first = addOpenTask(db, { created_at: now, deadline: now + 3_600_000 }, idFactory)
    const second = addOpenTask(db, { created_at: now, deadline: now + 3_600_000 }, idFactory)
    const third = addOpenTask(db, { created_at: now, deadline: now + 3_600_000 }, idFactory)
    db.events = []

    expect(claimTask(db, first.id, { player_id: 'p1' }, now, idFactory)).toMatchObject({
      points: 10,
      task_points: 10,
      combo_count: 1,
      combo_mult: 1
    })
    expect(claimTask(db, second.id, { player_id: 'p1' }, now, idFactory)).toMatchObject({
      points: 13,
      task_points: 13,
      combo_count: 2,
      combo_mult: 1.25
    })
    const thirdResult = claimTask(db, third.id, { player_id: 'p1' }, now, idFactory)
    expect(thirdResult).toMatchObject({
      points: 15,
      task_points: 15,
      combo_count: 3,
      combo_mult: 1.5
    })
    expect(db.players[0].score).toBe(38)
    expect(db.players[0].xp).toBe(38)
    expect(db.week_claims).toBe(3)
    expect(db.achievements.filter(item => item.key === 'first_task')).toHaveLength(1)
    expect(db.achievements.filter(item => item.key === 'combo_master')).toHaveLength(1)
  })

  it('adds comeback once per week after 48 hours', () => {
    const db = defaultDb()
    db.week_key = '2026-W02'
    const now = at('2026-01-07T12:00:00.000Z')
    db.players[0].last_claim_at = now - 48 * 3_600_000
    db.players[0].comeback_week_key = '2026-W01'
    const task = addOpenTask(db, { created_at: now, deadline: now + 3_600_000 }, ids('cb'))
    const result = claimTask(db, task.id, { player_id: 'p1' }, now, ids('cb-result'))
    expect(result.comeback).toBe(5)
    expect(result.points).toBe(result.task_points + 5)
    expect(db.players[0].comeback_week_key).toBe('2026-W02')
    expect(db.events.some(event => event.kind === 'comeback')).toBe(true)
  })

  it('maps claim errors without mutating the task', () => {
    const db = defaultDb()
    const task = addOpenTask(db)
    expectApiError(
      () => claimTask(db, task.id, { player_id: 'unknown' }, task.created_at, ids()),
      422,
      'Неизвестный игрок'
    )
    task.status = 'burned'
    expectApiError(
      () => claimTask(db, task.id, { player_id: 'p1' }, task.created_at, ids()),
      409,
      'Поздно: дело уже сгорело'
    )
    expectApiError(
      () => claimTask(db, 'missing', { player_id: 'p1' }, task.created_at, ids()),
      404,
      'Дело не найдено'
    )
  })
})

describe('sweep, repeat lifecycle and ISO seasons', () => {
  it('burns a prior-week deadline before snapshot and blocks zero-fires', () => {
    const db = defaultDb()
    db.week_key = '2025-W01'
    db.week_claims = 1
    db.players[0].score = 20
    db.players[1].score = 20
    addOpenTask(
      db,
      {
        base_points: 10,
        created_at: at('2025-01-05T21:00:00.000Z'),
        deadline: at('2025-01-05T23:59:00.000Z')
      },
      ids('old')
    )
    db.events = []

    expect(sweep(db, at('2025-01-06T00:00:00.000Z'), ids('sweep'))).toBe(true)
    expect(db.week_key).toBe('2025-W02')
    expect(db.seasons).toEqual([
      { week_key: '2025-W01', p1_score: 15, p2_score: 15, winner: null }
    ])
    expect(db.players.map(player => player.score)).toEqual([0, 0])
    expect(db.achievements.some(item => item.key === 'zero_fires')).toBe(false)
    expect(db.tasks[0]).toMatchObject({ status: 'burned', finished_at: db.tasks[0].deadline })
  })

  it('attributes an exact Monday deadline to the new week after old snapshot', () => {
    const db = defaultDb()
    db.week_key = '2025-W01'
    db.week_claims = 1
    db.players[0].score = 20
    db.players[1].score = 10
    const monday = at('2025-01-06T00:00:00.000Z')
    addOpenTask(
      db,
      { base_points: 10, created_at: monday - 3_600_000, deadline: monday },
      ids('boundary')
    )
    db.events = []

    sweep(db, monday, ids('boundary-sweep'))
    expect(db.seasons[0]).toEqual({
      week_key: '2025-W01',
      p1_score: 20,
      p2_score: 10,
      winner: 'p1'
    })
    expect(db.week_burns).toBe(1)
    expect(db.week_claims).toBe(0)
    expect(db.players.map(player => player.score)).toEqual([0, 0])
    expect(db.achievements.some(item => item.key === 'zero_fires')).toBe(true)
  })

  it('schedules exactly one repeat from observed time and later opens it with a fresh fuse', () => {
    const db = defaultDb()
    db.week_key = '2026-W02'
    const deadline = at('2026-01-07T10:00:00.000Z')
    const observed = at('2026-01-07T12:00:00.000Z')
    addOpenTask(
      db,
      {
        title: 'Повтор',
        created_at: deadline - HOUR,
        deadline,
        repeat_hours: 24,
        interval_hours: 24,
        fuse_hours: 1
      },
      ids('repeat')
    )
    db.events = []
    const idFactory = ids('life')

    sweep(db, observed, idFactory)
    const scheduled = db.tasks.filter(task => task.status === 'scheduled')
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].appear_at).toBe(observed + 24 * HOUR)
    expect(db.tasks[0].finished_at).toBe(deadline)

    const appears = scheduled[0].appear_at!
    sweep(db, appears, idFactory)
    expect(scheduled[0]).toMatchObject({
      status: 'open',
      created_at: appears,
      deadline: appears + HOUR,
      appear_at: null
    })
  })

  it('initializes an empty week silently and state view filters/sorts stored tasks', () => {
    const db = defaultDb()
    const now = at('2026-01-07T12:00:00.000Z')
    expect(sweep(db, now, ids())).toBe(true)
    expect(db.week_key).toBe('2026-W02')
    expect(db.events).toEqual([])

    addOpenTask(db, { title: 'Позже', deadline: now + 20_000 }, ids('view'))
    addOpenTask(db, { title: 'Раньше', deadline: now + 10_000 }, ids('view'))
    addOpenTask(
      db,
      { title: 'Закрыто', status: 'done', finished_at: now - 1_000 },
      ids('view')
    )
    addOpenTask(db, { title: 'Ждёт', status: 'scheduled', appear_at: now + HOUR }, ids('view'))
    const response = stateResponse(db, now)
    expect(response.tasks.map(task => task.title)).toEqual(['Раньше', 'Позже'])
    expect(response.history.map(task => task.title)).toEqual(['Закрыто'])
    expect(response.server_now).toBe(now)
  })
})

const HOUR = 3_600_000

describe('family shelf and memorable dates', () => {
  it('implements normalized shelf CRUD, duplicates, limit and stable update position', () => {
    const db = defaultDb()
    const idFactory = ids('shelf')
    const first = createShelfItem(
      db,
      { title: '  Полить цветы ', emoji: '', base_points: 2000, hours: 0, repeat: true },
      idFactory
    )
    const second = createShelfItem(db, { title: 'Второй' }, idFactory)
    expect(first).toMatchObject({
      title: 'Полить цветы',
      emoji: '📌',
      base_points: 1000,
      hours: 0.05,
      repeat: true,
      interval_hours: null
    })
    expect(db.family_shelf.map(item => item.id)).toEqual([second.id, first.id])
    const updated = updateShelfItem(db, first.id, { title: 'Обновлён' })
    expect(updated.id).toBe(first.id)
    expect(db.family_shelf.map(item => item.id)).toEqual([second.id, first.id])
    expect(deleteShelfItem(db, first.id)).toEqual({ ok: true })

    expectApiError(
      () => createShelfItem(db, { title: '  Второй ' }, idFactory),
      409,
      'Такой шаблон уже есть на полке'
    )
    db.family_shelf = Array.from({ length: 50 }, (_, index) => ({
      id: `full-${index}`,
      title: `Шаблон ${index}`,
      emoji: '📌',
      base_points: 10,
      hours: 24,
      repeat: false,
      interval_hours: null
    }))
    expectApiError(
      () => createShelfItem(db, { title: 'Лишний' }, idFactory),
      409,
      'На семейной полке уже 50 шаблонов'
    )
  })

  it('implements strict memorable date CRUD and exact normalized duplicates', () => {
    const db = defaultDb()
    const idFactory = ids('date')
    const first = createMemorableDate(
      db,
      { title: '  Наша встреча ', date: '2020-02-29', kind: 'meeting' },
      idFactory
    )
    const second = createMemorableDate(
      db,
      { title: 'День рождения', date: '1990-11-12', kind: 'birthday' },
      idFactory
    )
    expect(db.memorable_dates.map(item => item.id)).toEqual([second.id, first.id])
    const updated = updateMemorableDate(db, first.id, {
      title: 'Годовщина',
      date: '2021-07-01',
      kind: 'anniversary'
    })
    expect(updated.id).toBe(first.id)
    expect(db.memorable_dates.map(item => item.id)).toEqual([second.id, first.id])
    expect(deleteMemorableDate(db, first.id)).toEqual({ ok: true })

    expectApiError(
      () =>
        createMemorableDate(
          db,
          { title: 'Ошибка', date: '2023-02-29', kind: 'custom' },
          idFactory
        ),
      422,
      'Дата должна существовать и иметь формат YYYY-MM-DD'
    )
    expectApiError(
      () =>
        createMemorableDate(
          db,
          { title: 'Ошибка', date: '2026-02-01', kind: 'holiday' },
          idFactory
        ),
      422,
      'Тип даты: anniversary, meeting, birthday или custom'
    )

    createMemorableDate(
      db,
      { title: 'Дубль', date: '2020-07-01', kind: 'anniversary' },
      idFactory
    )
    expectApiError(
      () =>
        createMemorableDate(
          db,
          { title: '  Дубль ', date: '2020-07-01', kind: 'anniversary' },
          idFactory
        ),
      409,
      'Такая памятная дата уже есть'
    )
  })
})

describe('players, reactions and feed bound', () => {
  it('renames with control stripping and Rust-compatible 24-character truncation', () => {
    const db = defaultDb()
    const response = renamePlayer(db, 'p1', { name: `\u202e${'я'.repeat(30)}` })
    expect(Array.from(response.players[0].name)).toHaveLength(24)
    expect(response.players[0].name).not.toContain('\u202e')
    expectApiError(
      () => renamePlayer(db, 'missing', { name: 'Имя' }),
      404,
      'Игрок не найден'
    )
  })

  it('adds or replaces one allowed reaction per player on done events', () => {
    const db = defaultDb()
    const now = at('2026-01-07T12:00:00.000Z')
    const task = addOpenTask(db, { created_at: now, deadline: now + HOUR }, ids('react'))
    db.events = []
    claimTask(db, task.id, { player_id: 'p1' }, now, ids('react-claim'))
    const done = db.events.find(event => event.kind === 'done')!
    expect(reactEvent(db, done.id, { player_id: 'p2', emoji: '❤️' }).reactions).toEqual([
      { player_id: 'p2', emoji: '❤️' }
    ])
    expect(reactEvent(db, done.id, { player_id: 'p2', emoji: '🔥' }).reactions).toEqual([
      { player_id: 'p2', emoji: '🔥' }
    ])
    expectApiError(
      () => reactEvent(db, done.id, { player_id: 'p2', emoji: '👍' }),
      422,
      'Некорректная реакция'
    )
  })

  it('keeps only the 30 newest feed events', () => {
    const db = defaultDb()
    const idFactory = ids('feed')
    for (let index = 0; index < 31; index += 1) {
      createTask(db, { title: `Дело ${index}` }, index, idFactory)
    }
    expect(db.events).toHaveLength(30)
    expect(db.events[0].text).toContain('Дело 30')
    expect(db.events.at(-1)?.text).toContain('Дело 1')
  })
})
