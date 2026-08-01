<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import {
  MEMORABLE_KIND_META,
  anniversaryProgress,
  buildMonthGrid,
  formatDateKey,
  formatDateLong,
  localDateParts,
  parseDateKey,
  upcomingMemorableDates
} from '../memorableDates.js'
import { ruPlural } from '../utils.js'

const props = defineProps({
  open: Boolean,
  items: { type: Array, default: () => [] },
  now: { type: Number, required: true },
  createItem: { type: Function, default: null },
  updateItem: { type: Function, default: null },
  deleteItem: { type: Function, default: null }
})

const emit = defineEmits(['close'])

const dialog = ref(null)
const closeButton = ref(null)
const addButton = ref(null)
const titleInput = ref(null)
const viewYear = ref(0)
const viewMonth = ref(0)
const selectedKey = ref('')
const formMode = ref(null)
const editingId = ref(null)
const editingLabel = ref('')
const draft = ref({ title: '', date: '', kind: 'custom' })
const saveBusy = ref(false)
const deleteBusyId = ref(null)
const pendingDeleteId = ref(null)
const errorMessage = ref('')
const statusMessage = ref('')

let formTrigger = null
const dayRefs = new Map()
const deleteCancelRefs = new Map()
const deleteButtonRefs = new Map()

const kindOrder = ['birthday', 'anniversary', 'meeting', 'custom']
const kinds = computed(() =>
  kindOrder.map(id => ({ id, ...kindPresentation(id) }))
)
const today = computed(() => localDateParts(props.now))
const todayKey = computed(() => formatDateKey(today.value))
const monthCells = computed(() =>
  buildMonthGrid(viewYear.value, viewMonth.value, props.items, today.value)
)
const monthRows = computed(() => {
  const rows = []
  for (let index = 0; index < monthCells.value.length; index += 7) {
    rows.push(monthCells.value.slice(index, index + 7))
  }
  return rows
})
const upcoming = computed(() => upcomingMemorableDates(props.items, today.value, 4))
const selectedCell = computed(() =>
  monthCells.value.find(cell => cell.key === selectedKey.value)
)
const selectedEvents = computed(() => selectedCell.value?.events ?? [])
const selectedLabel = computed(() => {
  const parts = parseDateKey(selectedKey.value)
  return parts ? formatDateLong(parts) : 'Выбранный день'
})
const monthLabel = computed(() =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(viewYear.value, viewMonth.value - 1, 15))
  )
)
const isBusy = computed(() => saveBusy.value || deleteBusyId.value !== null)
const canSave = computed(() => {
  const parsed = parseDateKey(draft.value.date)
  return (
    !!draft.value.title.trim() &&
    !!parsed &&
    draft.value.date <= todayKey.value &&
    kindOrder.includes(draft.value.kind)
  )
})

function kindPresentation(kind) {
  const raw = MEMORABLE_KIND_META[kind] ?? MEMORABLE_KIND_META.custom ?? {}
  return {
    label: raw.label ?? raw.title ?? 'Другое',
    emoji: raw.emoji ?? raw.icon ?? '⭐'
  }
}

function anniversaryLabel(event) {
  const number = event.anniversaryNumber ?? event.occurrence?.anniversaryNumber
  if (!Number.isInteger(number) || number <= 0) return ''
  const years = amount(number, 'год', 'года', 'лет')
  if (event.kind === 'birthday') return `исполнится ${years}`
  return years
}

function amount(value, one, few, many) {
  return `${value} ${ruPlural(value, one, few, many)}`
}

function progressLabel(event) {
  const progress = anniversaryProgress(event, today.value)
  if (!progress) return ''
  if (!progress.started) return 'ещё не наступило'

  const years = amount(progress.fullYears, 'год', 'года', 'лет')
  if (event.kind === 'birthday') {
    return amount(progress.fullYears, 'полный год', 'полных года', 'полных лет')
  }

  const days = amount(progress.daysAfterAnniversary, 'день', 'дня', 'дней')
  const total = amount(progress.totalDays, 'день', 'дня', 'дней')
  const prefix = event.kind === 'meeting' ? 'вместе ' : ''
  return `${prefix}${years} ${days} · всего ${total}`
}

function upcomingWhen(entry) {
  const days = entry.occurrence?.daysUntil
  if (days === 0) return 'сегодня'
  if (days === 1) return 'завтра'
  return Number.isFinite(days) ? `через ${days} дн.` : ''
}

function dayAriaLabel(cell) {
  const names = cell.events.map(event => event.title).join(', ')
  return names ? `${formatDateLong(cell.date)}: ${names}` : formatDateLong(cell.date)
}

function resetToToday() {
  const current = today.value
  viewYear.value = current.year
  viewMonth.value = current.month
  selectedKey.value = formatDateKey(current)
}

function clearFeedback() {
  errorMessage.value = ''
  statusMessage.value = ''
}

function requestClose() {
  if (isBusy.value) return
  emit('close')
}

function moveMonth(delta) {
  const zeroBased = viewMonth.value - 1 + delta
  const date = new Date(Date.UTC(viewYear.value, zeroBased, 1))
  viewYear.value = date.getUTCFullYear()
  viewMonth.value = date.getUTCMonth() + 1
  selectedKey.value = formatDateKey({
    year: viewYear.value,
    month: viewMonth.value,
    day: 1
  })
  pendingDeleteId.value = null
  nextTick(focusSelectedDay)
}

function goToday() {
  resetToToday()
  pendingDeleteId.value = null
  nextTick(focusSelectedDay)
}

function selectDay(cell, { focus = false } = {}) {
  const changedMonth = !cell.inMonth
  selectedKey.value = cell.key
  pendingDeleteId.value = null
  if (changedMonth) {
    viewYear.value = cell.date.year
    viewMonth.value = cell.date.month
  }
  if (focus || changedMonth) nextTick(focusSelectedDay)
}

function openUpcoming(entry) {
  if (isBusy.value) return
  const date = entry.occurrence?.date
  if (!date) return
  viewYear.value = date.year
  viewMonth.value = date.month
  selectedKey.value = formatDateKey(date)
  formMode.value = null
  pendingDeleteId.value = null
  clearFeedback()
  nextTick(focusSelectedDay)
}

function setDayRef(key, element) {
  if (element) dayRefs.set(key, element)
  else dayRefs.delete(key)
}

function focusSelectedDay() {
  dayRefs.get(selectedKey.value)?.focus()
}

function onDayKeydown(event, rowIndex, columnIndex) {
  let targetIndex = rowIndex * 7 + columnIndex
  if (event.key === 'ArrowLeft') targetIndex -= 1
  else if (event.key === 'ArrowRight') targetIndex += 1
  else if (event.key === 'ArrowUp') targetIndex -= 7
  else if (event.key === 'ArrowDown') targetIndex += 7
  else if (event.key === 'Home') targetIndex = rowIndex * 7
  else if (event.key === 'End') targetIndex = rowIndex * 7 + 6
  else if (event.key === 'PageUp' || event.key === 'PageDown') {
    event.preventDefault()
    moveMonth(event.key === 'PageUp' ? -1 : 1)
    return
  } else {
    return
  }
  const target = monthCells.value[targetIndex]
  if (!target) return
  event.preventDefault()
  selectDay(target, { focus: true })
}

function openCreate(event) {
  if (isBusy.value) return
  formTrigger = event?.currentTarget ?? null
  const date = selectedKey.value && selectedKey.value <= todayKey.value
    ? selectedKey.value
    : todayKey.value
  draft.value = { title: '', date, kind: 'custom' }
  formMode.value = 'create'
  editingId.value = null
  editingLabel.value = ''
  pendingDeleteId.value = null
  clearFeedback()
  nextTick(() => titleInput.value?.focus())
}

function openEdit(item, event) {
  if (isBusy.value || pendingDeleteId.value) return
  formTrigger = event?.currentTarget ?? null
  draft.value = { title: item.title, date: item.date, kind: item.kind }
  formMode.value = 'edit'
  editingId.value = item.id
  editingLabel.value = item.title
  clearFeedback()
  nextTick(() => {
    titleInput.value?.focus()
    titleInput.value?.select?.()
  })
}

function closeForm({ restoreFocus = true, force = false } = {}) {
  if (saveBusy.value && !force) return
  formMode.value = null
  editingId.value = null
  editingLabel.value = ''
  const trigger = formTrigger
  formTrigger = null
  if (restoreFocus) {
    nextTick(() => {
      if (trigger?.isConnected) trigger.focus()
      else addButton.value?.focus()
    })
  }
}

async function saveForm() {
  if (!canSave.value || saveBusy.value) return
  const payload = {
    title: draft.value.title.trim(),
    date: draft.value.date,
    kind: draft.value.kind
  }
  saveBusy.value = true
  clearFeedback()
  try {
    if (formMode.value === 'edit') {
      if (!props.updateItem) throw new Error('Изменение дат недоступно')
      await props.updateItem(editingId.value, payload)
      closeForm({ restoreFocus: false, force: true })
      statusMessage.value = `«${payload.title}» обновлено`
    } else {
      if (!props.createItem) throw new Error('Добавление дат недоступно')
      await props.createItem(payload)
      closeForm({ restoreFocus: false, force: true })
      statusMessage.value = `«${payload.title}» добавлено`
    }
  } catch (error) {
    errorMessage.value = error?.message || 'Не удалось сохранить дату'
  } finally {
    saveBusy.value = false
    nextTick(() => {
      if (formMode.value) titleInput.value?.focus()
      else addButton.value?.focus()
    })
  }
}

function setDeleteCancelRef(id, element) {
  if (element) deleteCancelRefs.set(id, element)
  else deleteCancelRefs.delete(id)
}

function setDeleteButtonRef(id, element) {
  if (element) deleteButtonRefs.set(id, element)
  else deleteButtonRefs.delete(id)
}

function focusDeleteOriginOrCalendar(id) {
  nextTick(() => {
    const origin = deleteButtonRefs.get(id)
    if (origin) origin.focus()
    else if (dayRefs.get(selectedKey.value)) focusSelectedDay()
    else addButton.value?.focus()
  })
}

function beginDelete(item) {
  if (isBusy.value || formMode.value) return
  pendingDeleteId.value = item.id
  clearFeedback()
  nextTick(() => deleteCancelRefs.get(item.id)?.focus())
}

function cancelDelete() {
  if (deleteBusyId.value) return
  const id = pendingDeleteId.value
  pendingDeleteId.value = null
  if (id) focusDeleteOriginOrCalendar(id)
}

async function confirmDelete(item) {
  if (pendingDeleteId.value !== item.id || deleteBusyId.value) return
  deleteBusyId.value = item.id
  clearFeedback()
  try {
    if (!props.deleteItem) throw new Error('Удаление дат недоступно')
    await props.deleteItem(item.id)
    pendingDeleteId.value = null
    statusMessage.value = `«${item.title}» удалено`
    focusDeleteOriginOrCalendar(item.id)
  } catch (error) {
    errorMessage.value = error?.message || 'Не удалось удалить дату'
  } finally {
    const shouldRestoreDeleteFocus = pendingDeleteId.value === item.id
    deleteBusyId.value = null
    if (shouldRestoreDeleteFocus) {
      nextTick(() => deleteCancelRefs.get(item.id)?.focus())
    }
  }
}

function onDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (pendingDeleteId.value && !deleteBusyId.value) cancelDelete()
    else if (formMode.value && !saveBusy.value) closeForm()
    else requestClose()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...dialog.value.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )].filter(element => element.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async open => {
    if (!open) return
    resetToToday()
    formMode.value = null
    editingId.value = null
    pendingDeleteId.value = null
    clearFeedback()
    await nextTick()
    closeButton.value?.focus()
  }
)

watch(
  [() => props.items, saveBusy, deleteBusyId],
  ([items]) => {
    const ids = new Set((items ?? []).map(item => item.id))
    if (pendingDeleteId.value && !ids.has(pendingDeleteId.value) && !deleteBusyId.value) {
      const deletedId = pendingDeleteId.value
      pendingDeleteId.value = null
      errorMessage.value = ''
      statusMessage.value = 'Дата уже удалена на другом устройстве'
      focusDeleteOriginOrCalendar(deletedId)
    }
    if (editingId.value && !ids.has(editingId.value) && !saveBusy.value) {
      closeForm({ restoreFocus: false })
      statusMessage.value = ''
      errorMessage.value = 'Дата удалена на другом устройстве'
      nextTick(() => addButton.value?.focus())
    }
  }
)
</script>

<template>
  <Transition name="memorable-fade">
    <div v-if="open" class="memorable-overlay" @click.self="requestClose">
      <section
        ref="dialog"
        class="memorable-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memorable-title"
        :aria-busy="isBusy"
        @keydown="onDialogKeydown"
      >
        <header class="memorable-header">
          <div>
            <h2 id="memorable-title">📅 Памятные даты</h2>
            <p>Все даты повторяются каждый год</p>
          </div>
          <button
            ref="closeButton"
            type="button"
            class="icon-button"
            aria-label="Закрыть памятные даты"
            :disabled="isBusy"
            @click="requestClose"
          >✕</button>
        </header>

        <p v-if="errorMessage" class="memorable-feedback error" role="alert">
          {{ errorMessage }}
        </p>
        <p v-else-if="statusMessage" class="memorable-feedback" role="status" aria-live="polite">
          {{ statusMessage }}
        </p>

        <section class="upcoming-section" aria-labelledby="upcoming-title">
          <div class="section-heading">
            <h3 id="upcoming-title">Ближайшие</h3>
            <button
              ref="addButton"
              type="button"
              class="small-action primary"
              :disabled="isBusy"
              @click="openCreate"
            >+ Добавить</button>
          </div>
          <div v-if="upcoming.length" class="upcoming-list">
            <button
              v-for="entry in upcoming"
              :key="entry.id"
              type="button"
              class="upcoming-card"
              :disabled="isBusy"
              @click="openUpcoming(entry)"
            >
              <span class="event-emoji" aria-hidden="true">{{ kindPresentation(entry.kind).emoji }}</span>
              <span class="event-copy">
                <strong>{{ entry.title }}</strong>
                <small>
                  {{ formatDateLong(entry.occurrence.date) }}
                  <template v-if="anniversaryLabel(entry)"> · {{ anniversaryLabel(entry) }}</template>
                </small>
              </span>
              <span class="when-badge">{{ upcomingWhen(entry) }}</span>
            </button>
          </div>
          <p v-else class="empty-copy">Добавьте день рождения, годовщину или важную встречу.</p>
        </section>

        <div class="memorable-layout">
          <section class="calendar-panel" aria-labelledby="calendar-month">
            <div class="calendar-nav">
              <button type="button" class="icon-button" aria-label="Предыдущий месяц" :disabled="isBusy" @click="moveMonth(-1)">‹</button>
              <h3 id="calendar-month" aria-live="polite">{{ monthLabel }}</h3>
              <button type="button" class="today-button" :disabled="isBusy" @click="goToday">Сегодня</button>
              <button type="button" class="icon-button" aria-label="Следующий месяц" :disabled="isBusy" @click="moveMonth(1)">›</button>
            </div>

            <table class="calendar-table" :aria-label="`Календарь, ${monthLabel}`">
              <thead>
                <tr>
                  <th v-for="weekday in ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']" :key="weekday" scope="col">
                    {{ weekday }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in monthRows" :key="row[0].key">
                  <td v-for="(cell, columnIndex) in row" :key="cell.key">
                    <button
                      :ref="element => setDayRef(cell.key, element)"
                      type="button"
                      class="calendar-day"
                      :class="{
                        outside: !cell.inMonth,
                        selected: selectedKey === cell.key,
                        today: cell.isToday,
                        'has-events': cell.events.length
                      }"
                      :tabindex="selectedKey === cell.key ? 0 : -1"
                      :aria-label="dayAriaLabel(cell)"
                      :aria-pressed="selectedKey === cell.key"
                      :aria-current="cell.isToday ? 'date' : undefined"
                      :disabled="isBusy"
                      @click="selectDay(cell)"
                      @keydown="onDayKeydown($event, rowIndex, columnIndex)"
                    >
                      <span class="day-number">{{ cell.day }}</span>
                      <span v-if="cell.events.length" class="event-dots" aria-hidden="true">
                        <i
                          v-for="event in cell.events.slice(0, 2)"
                          :key="event.id"
                          :class="`kind-${event.kind}`"
                        ></i>
                        <small v-if="cell.events.length > 2">+{{ cell.events.length - 2 }}</small>
                      </span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="day-panel" :aria-labelledby="formMode ? 'memorable-form-title' : 'selected-day-title'">
            <form v-if="formMode" class="memorable-form" @submit.prevent="saveForm">
              <div class="section-heading">
                <div>
                  <h3 id="memorable-form-title">
                    {{ formMode === 'edit' ? 'Изменить дату' : 'Новая дата' }}
                  </h3>
                  <small v-if="editingLabel">{{ editingLabel }}</small>
                </div>
                <button type="button" class="text-button" :disabled="saveBusy" @click="closeForm">Отмена</button>
              </div>

              <label for="memorable-name">Название</label>
              <input
                id="memorable-name"
                ref="titleInput"
                v-model="draft.title"
                type="text"
                maxlength="80"
                autocomplete="off"
                placeholder="Например, день рождения Маши"
                :disabled="saveBusy"
              />

              <label for="memorable-date">Дата</label>
              <input
                id="memorable-date"
                v-model="draft.date"
                type="date"
                :max="todayKey"
                :disabled="saveBusy"
              />

              <fieldset :disabled="saveBusy">
                <legend>Категория</legend>
                <div class="kind-grid">
                  <label v-for="kind in kinds" :key="kind.id" class="kind-option" :class="{ selected: draft.kind === kind.id }">
                    <input v-model="draft.kind" type="radio" name="memorable-kind" :value="kind.id" />
                    <span aria-hidden="true">{{ kind.emoji }}</span>
                    {{ kind.label }}
                  </label>
                </div>
              </fieldset>

              <button type="submit" class="save-button" :disabled="!canSave || saveBusy">
                {{ saveBusy ? 'Сохранение…' : formMode === 'edit' ? 'Сохранить изменения' : 'Добавить дату' }}
              </button>
            </form>

            <template v-else>
              <div class="section-heading">
                <h3 id="selected-day-title">{{ selectedLabel }}</h3>
                <button type="button" class="small-action" :disabled="isBusy" @click="openCreate">+ Дата</button>
              </div>

              <div v-if="selectedEvents.length" class="selected-events">
                <article v-for="event in selectedEvents" :key="event.id" class="selected-event">
                  <template v-if="pendingDeleteId !== event.id">
                    <span class="event-emoji" aria-hidden="true">{{ kindPresentation(event.kind).emoji }}</span>
                    <span class="event-copy">
                      <strong>{{ event.title }}</strong>
                      <small>
                        {{ kindPresentation(event.kind).label }}
                        <template v-if="anniversaryLabel(event)"> · {{ anniversaryLabel(event) }}</template>
                      </small>
                      <small class="event-progress">{{ progressLabel(event) }}</small>
                    </span>
                    <button
                      type="button"
                      class="icon-button event-action"
                      :aria-label="`Изменить «${event.title}»`"
                      :disabled="isBusy"
                      @click="openEdit(event, $event)"
                    >✎</button>
                    <button
                      :ref="element => setDeleteButtonRef(event.id, element)"
                      type="button"
                      class="icon-button event-action danger"
                      :aria-label="`Удалить «${event.title}»`"
                      :disabled="isBusy"
                      @click="beginDelete(event)"
                    >🗑</button>
                  </template>

                  <div v-else class="delete-confirm" role="group" :aria-label="`Удалить «${event.title}»?`">
                    <span>Удалить «{{ event.title }}»?</span>
                    <button
                      :ref="element => setDeleteCancelRef(event.id, element)"
                      type="button"
                      class="small-action"
                      :disabled="deleteBusyId === event.id"
                      @click="cancelDelete"
                    >Отмена</button>
                    <button
                      type="button"
                      class="small-action danger"
                      :disabled="deleteBusyId === event.id"
                      @click="confirmDelete(event)"
                    >{{ deleteBusyId === event.id ? 'Удаление…' : 'Удалить' }}</button>
                  </div>
                </article>
              </div>
              <p v-else class="empty-copy">На этот день ничего не записано.</p>
            </template>
          </section>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.memorable-overlay {
  position: fixed;
  inset: 0;
  z-index: 230;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(7px);
}

.memorable-dialog {
  width: min(780px, 100%);
  max-height: min(92vh, 860px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid var(--card-border);
  border-radius: 22px;
  background: var(--card);
  color: var(--text);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
}

.memorable-header,
.section-heading,
.calendar-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.memorable-header h2,
.section-heading h3,
.calendar-nav h3 {
  margin: 0;
}

.section-heading > div {
  min-width: 0;
}

.memorable-header h2 {
  font-size: 22px;
}

.memorable-header p,
.section-heading small {
  display: block;
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12.5px;
}

.icon-button,
.small-action,
.text-button,
.today-button,
.upcoming-card,
.calendar-day,
.kind-option,
.save-button {
  font: inherit;
}

.icon-button,
.small-action,
.today-button,
.text-button {
  min-height: 38px;
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
}

.icon-button {
  min-width: 38px;
  padding: 6px;
}

.small-action,
.today-button,
.text-button {
  padding: 7px 11px;
  font-size: 12.5px;
  font-weight: 700;
}

.small-action.primary,
.save-button {
  border-color: rgba(255, 209, 102, 0.55);
  background: rgba(255, 209, 102, 0.16);
}

.text-button {
  border-color: transparent;
  background: transparent;
  color: var(--muted);
}

.danger,
.memorable-feedback.error {
  color: var(--danger);
}

.memorable-feedback {
  margin: 12px 0 0;
  padding: 8px 10px;
  border: 1px solid rgba(138, 255, 193, 0.3);
  border-radius: 10px;
  color: #8affc1;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.memorable-feedback.error {
  border-color: rgba(255, 94, 108, 0.4);
}

.upcoming-section {
  margin-top: 16px;
}

.section-heading h3,
.calendar-nav h3 {
  font-size: 15px;
}

.upcoming-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 9px;
}

.upcoming-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 52px;
  padding: 8px 10px;
  border: 1px solid var(--card-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  text-align: left;
}

.event-emoji {
  font-size: 20px;
}

.event-copy {
  min-width: 0;
}

.event-copy strong,
.event-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-copy strong {
  font-size: 13.5px;
}

.event-copy .event-progress {
  margin-top: 2px;
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.3;
}

.event-copy small,
.empty-copy {
  color: var(--muted);
  font-size: 11.5px;
}

.when-badge {
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(122, 162, 247, 0.14);
  color: #a9c1ff;
  font-size: 10.5px;
  white-space: nowrap;
}

.empty-copy {
  margin: 10px 0 0;
  line-height: 1.45;
}

.memorable-layout {
  display: grid;
  grid-template-columns: minmax(330px, 1.25fr) minmax(250px, 0.85fr);
  gap: 14px;
  margin-top: 16px;
}

.calendar-panel,
.day-panel {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--card-border);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.025);
}

.calendar-nav {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto 38px;
}

.calendar-nav h3 {
  text-align: center;
  text-transform: capitalize;
}

.calendar-table {
  width: 100%;
  margin-top: 9px;
  table-layout: fixed;
  border-spacing: 4px;
}

.calendar-table th {
  padding: 2px;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
}

.calendar-table td {
  padding: 0;
}

.calendar-day {
  position: relative;
  width: 100%;
  min-height: 44px;
  padding: 5px 3px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
}

.calendar-day.outside {
  color: var(--muted);
  opacity: 0.45;
}

.calendar-day.today {
  border-color: rgba(122, 162, 247, 0.65);
}

.calendar-day.selected {
  border-color: rgba(255, 209, 102, 0.75);
  background: rgba(255, 209, 102, 0.15);
}

.day-number {
  display: block;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.event-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 9px;
  margin-top: 2px;
}

.event-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffd166;
}

.event-dots .kind-birthday { background: #b388ff; }
.event-dots .kind-anniversary { background: #ff8ba7; }
.event-dots .kind-meeting { background: #7aa2f7; }
.event-dots .kind-custom { background: #8affc1; }

.event-dots small {
  color: var(--muted);
  font-size: 8px;
}

.selected-events {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 10px;
}

.selected-event {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 38px 38px;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 7px;
  border: 1px solid var(--card-border);
  border-radius: 11px;
}

.event-action {
  min-height: 38px;
}

.delete-confirm {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.delete-confirm span,
.section-heading small {
  min-width: 0;
  overflow-wrap: anywhere;
}

.memorable-form {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.memorable-form > label,
.memorable-form legend {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.memorable-form input[type='text'],
.memorable-form input[type='date'] {
  width: 100%;
  min-height: 42px;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.16);
  color: var(--text);
  font: inherit;
  font-size: 14px;
}

.memorable-form fieldset {
  min-width: 0;
  margin: 2px 0 0;
  padding: 0;
  border: 0;
}

.kind-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 6px;
}

.kind-option {
  display: flex;
  min-height: 40px;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 11.5px;
}

.kind-option.selected {
  border-color: rgba(255, 209, 102, 0.65);
  background: rgba(255, 209, 102, 0.12);
}

.kind-option input {
  margin: 0;
}

.save-button {
  min-height: 44px;
  margin-top: 3px;
  border: 1px solid rgba(255, 209, 102, 0.6);
  border-radius: 11px;
  color: var(--text);
  font-weight: 800;
}

:is(button, input):focus-visible,
.kind-option:has(input:focus-visible) {
  outline: 2px solid #ffd166;
  outline-offset: 2px;
}

button:disabled,
input:disabled,
fieldset:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.memorable-fade-enter-active,
.memorable-fade-leave-active {
  transition: opacity 0.18s ease;
}

.memorable-fade-enter-from,
.memorable-fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .memorable-overlay {
    place-items: stretch;
    padding: 0;
  }

  .memorable-dialog {
    width: 100%;
    max-height: 100dvh;
    min-height: 100dvh;
    padding: max(14px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
    border: 0;
    border-radius: 0;
  }

  .upcoming-list,
  .memorable-layout {
    grid-template-columns: 1fr;
  }

  .upcoming-list {
    max-height: 184px;
    overflow-y: auto;
  }

  .memorable-layout {
    gap: 10px;
  }

  .calendar-panel,
  .day-panel {
    padding: 9px;
  }

  .calendar-table {
    border-spacing: 2px;
  }

  .icon-button,
  .small-action,
  .today-button,
  .text-button,
  .calendar-day,
  .kind-option,
  .memorable-form input[type='text'],
  .memorable-form input[type='date'] {
    min-height: 44px;
  }

  .selected-event {
    grid-template-columns: auto minmax(0, 1fr) 44px 44px;
  }

  .delete-confirm {
    grid-template-columns: 1fr 1fr;
  }

  .delete-confirm span {
    grid-column: 1 / -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .memorable-fade-enter-active,
  .memorable-fade-leave-active {
    transition: none;
  }
}
</style>
