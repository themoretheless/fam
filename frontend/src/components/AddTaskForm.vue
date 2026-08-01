<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { formatPoints } from '../utils.js'
import {
  PRESETS,
  PRESET_GROUPS,
  SIZE_PRESETS,
  loadAddDefaults,
  saveAddDefaults,
  positiveFiniteNumber,
  resolvePresetInterval,
  isCustomInterval,
  matchHeuristic,
  filterPresets,
  filterFamilyShelf,
  buildShelfPayload
} from '../presets.js'

const props = defineProps({
  familyShelf: { type: Array, default: () => [] },
  createShelfItem: { type: Function, default: null },
  updateShelfItem: { type: Function, default: null },
  deleteShelfItem: { type: Function, default: null }
})

const emit = defineEmits(['add'])

const open = ref(false)
const flash = ref(false)
const title = ref('')
const emoji = ref('🧺')
const points = ref(10)
const hours = ref(24)
const intervalHours = ref(24)
const intervalCustom = ref(false)
const repeat = ref(false)
const titleInput = ref(null)
const emojiTouched = ref(false)
const metricsTouched = ref(false)
const sizeId = ref('normal')
const groupId = ref('all')
const presetQuery = ref('')
const presetSearchInput = ref(null)
const mode = ref('task')
const editingId = ref(null)
const editingLabel = ref('')
const draftBeforeEdit = ref(null)
const shelfBusy = ref(false)
const deleteBusyId = ref(null)
const pendingDeleteId = ref(null)
const shelfStatus = ref('')
const shelfError = ref('')

let editTrigger = null
let deleteTrigger = null
const deleteCancelRefs = new Map()

const emojis = ['🧺', '🍳', '🧹', '🛒', '🐕', '🚗', '💡', '🧸', '🗑️', '🪴', '🍽️', '🧽', '🛏️', '🛁', '💳', '📦']
const pointChips = [5, 10, 20, 30, 50]
const hourChips = [
  { l: '1ч', v: 1 },
  { l: '3ч', v: 3 },
  { l: '6ч', v: 6 },
  { l: '12ч', v: 12 },
  { l: 'сутки', v: 24 },
  { l: '2 дня', v: 48 },
  { l: 'неделя', v: 168 }
]

const visiblePresets = computed(() => filterPresets(PRESETS, presetQuery.value, groupId.value))
const visibleFamilyShelf = computed(() =>
  filterFamilyShelf(props.familyShelf, presetQuery.value)
)
const isEditingShelf = computed(() => mode.value === 'shelf-edit')
const interactionLocked = computed(
  () =>
    isEditingShelf.value ||
    shelfBusy.value ||
    deleteBusyId.value !== null ||
    pendingDeleteId.value !== null
)
const canPersistShelf = computed(() => {
  if (!title.value.trim()) return false
  if (!positiveFiniteNumber(points.value) || !positiveFiniteNumber(hours.value)) return false
  if (repeat.value && intervalCustom.value && !positiveFiniteNumber(intervalHours.value)) return false
  return true
})

function applyLastDefaults() {
  const d = loadAddDefaults()
  if (!d) {
    intervalCustom.value = false
    sizeId.value = 'normal'
    applySize('normal')
    metricsTouched.value = false
    return
  }
  if (d.emoji) emoji.value = d.emoji
  if (d.base_points) points.value = d.base_points
  if (d.hours) hours.value = d.hours
  if (d.interval_hours) intervalHours.value = d.interval_hours
  intervalCustom.value = isCustomInterval(d.interval_hours, d.hours)
  repeat.value = !!d.repeat
  sizeId.value = matchSizeId(points.value, hours.value)
  emojiTouched.value = false
  metricsTouched.value = false
}

function matchSizeId(p, h) {
  const hit = SIZE_PRESETS.find(s => s.base_points === p && s.hours === h)
  return hit ? hit.id : null
}

function currentFuseHours() {
  return positiveFiniteNumber(hours.value) ?? 24
}

function syncAutoInterval() {
  if (!intervalCustom.value) intervalHours.value = currentFuseHours()
}

function applySize(id) {
  const s = SIZE_PRESETS.find(x => x.id === id)
  if (!s) return
  sizeId.value = id
  points.value = s.base_points
  hours.value = s.hours
  syncAutoInterval()
  metricsTouched.value = true
}

function setDraft(draft) {
  title.value = draft.title
  emoji.value = draft.emoji
  points.value = draft.points
  hours.value = draft.hours
  intervalHours.value = draft.intervalHours
  intervalCustom.value = draft.intervalCustom
  repeat.value = draft.repeat
  sizeId.value = draft.sizeId
  emojiTouched.value = draft.emojiTouched
  metricsTouched.value = draft.metricsTouched
}

function captureDraft() {
  return {
    title: title.value,
    emoji: emoji.value,
    points: points.value,
    hours: hours.value,
    intervalHours: intervalHours.value,
    intervalCustom: intervalCustom.value,
    repeat: repeat.value,
    sizeId: sizeId.value,
    emojiTouched: emojiTouched.value,
    metricsTouched: metricsTouched.value
  }
}

function hydrateFromPreset(p) {
  const presetInterval = resolvePresetInterval(p)
  setDraft({
    title: p.title,
    emoji: p.emoji,
    points: p.base_points,
    hours: p.hours,
    intervalHours: presetInterval.interval_hours ?? positiveFiniteNumber(p.hours) ?? 24,
    intervalCustom: !!p.repeat && presetInterval.custom,
    repeat: !!p.repeat,
    sizeId: matchSizeId(p.base_points, p.hours),
    emojiTouched: true,
    metricsTouched: true
  })
}

function applyPreset(p) {
  if (interactionLocked.value) return
  hydrateFromPreset(p)
  shelfStatus.value = `Шаблон «${p.title}» применён`
  shelfError.value = ''
  titleInput.value?.focus()
}

function applyFamilyPreset(item) {
  applyPreset(item)
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    if (!isEditingShelf.value) {
      applyLastDefaults()
      presetQuery.value = ''
      groupId.value = 'all'
    }
    await nextTick()
    titleInput.value?.focus()
  }
}

watch(title, t => {
  const h = matchHeuristic(t)
  if (!h) return
  if (!emojiTouched.value) emoji.value = h.emoji
  if (!metricsTouched.value) {
    if (h.base_points) points.value = h.base_points
    if (h.hours) {
      hours.value = h.hours
      syncAutoInterval()
    }
    sizeId.value = matchSizeId(points.value, hours.value)
  }
})

function onEmojiPick(e) {
  emoji.value = e
  emojiTouched.value = true
}

function onPointsPick(p) {
  points.value = p
  metricsTouched.value = true
  sizeId.value = matchSizeId(points.value, hours.value)
}

function onHoursPick(h) {
  hours.value = h
  syncAutoInterval()
  metricsTouched.value = true
  sizeId.value = matchSizeId(points.value, hours.value)
}

function onPointsInput() {
  metricsTouched.value = true
  sizeId.value = matchSizeId(points.value, hours.value)
}

function onHoursInput() {
  metricsTouched.value = true
  sizeId.value = matchSizeId(points.value, hours.value)
  syncAutoInterval()
}

function onIntervalPick(h) {
  intervalHours.value = h
  intervalCustom.value = true
}

function onIntervalInput() {
  intervalCustom.value = true
}

function toggleRepeat() {
  repeat.value = !repeat.value
  if (repeat.value) syncAutoInterval()
}

function currentShelfPayload() {
  return buildShelfPayload({
    title: title.value,
    emoji: emoji.value,
    base_points: points.value,
    hours: hours.value,
    repeat: repeat.value,
    interval_hours: intervalHours.value,
    interval_custom: intervalCustom.value
  })
}

function errorText(error, fallback) {
  return error?.message || fallback
}

async function saveToShelf() {
  if (!canPersistShelf.value || interactionLocked.value) return
  shelfBusy.value = true
  shelfError.value = ''
  shelfStatus.value = ''
  const payload = currentShelfPayload()
  try {
    if (!props.createShelfItem) throw new Error('Сохранение шаблонов недоступно')
    await props.createShelfItem(payload)
    shelfStatus.value = `Шаблон «${payload.title}» сохранён на полку`
  } catch (error) {
    shelfError.value = errorText(error, 'Не удалось сохранить шаблон')
  } finally {
    shelfBusy.value = false
  }
}

async function startShelfEdit(item, event) {
  if (interactionLocked.value) return
  draftBeforeEdit.value = captureDraft()
  editingId.value = item.id
  editingLabel.value = item.title
  editTrigger = event?.currentTarget ?? null
  pendingDeleteId.value = null
  shelfError.value = ''
  shelfStatus.value = ''
  mode.value = 'shelf-edit'
  hydrateFromPreset(item)
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select?.()
}

function finishShelfEdit({ focusTrigger = false } = {}) {
  const savedDraft = draftBeforeEdit.value
  mode.value = 'task'
  editingId.value = null
  editingLabel.value = ''
  draftBeforeEdit.value = null
  if (savedDraft) setDraft(savedDraft)
  const target = editTrigger
  editTrigger = null
  nextTick(() => {
    if (focusTrigger && target?.isConnected) target.focus()
    else titleInput.value?.focus()
  })
}

function cancelShelfEdit() {
  if (!isEditingShelf.value || shelfBusy.value) return
  finishShelfEdit({ focusTrigger: true })
}

async function saveShelfChanges() {
  if (!isEditingShelf.value || !canPersistShelf.value || shelfBusy.value) return
  const id = editingId.value
  const payload = currentShelfPayload()
  shelfBusy.value = true
  shelfError.value = ''
  shelfStatus.value = ''
  try {
    if (!props.updateShelfItem) throw new Error('Изменение шаблонов недоступно')
    await props.updateShelfItem(id, payload)
    finishShelfEdit()
    shelfStatus.value = `Шаблон «${payload.title}» обновлён`
  } catch (error) {
    shelfError.value = errorText(error, 'Не удалось обновить шаблон')
  } finally {
    shelfBusy.value = false
  }
}

function setDeleteCancelRef(id, element) {
  if (element) deleteCancelRefs.set(id, element)
  else deleteCancelRefs.delete(id)
}

async function beginShelfDelete(item, event) {
  if (interactionLocked.value) return
  pendingDeleteId.value = item.id
  deleteTrigger = event?.currentTarget ?? null
  shelfError.value = ''
  shelfStatus.value = ''
  await nextTick()
  deleteCancelRefs.get(item.id)?.focus()
}

function cancelShelfDelete() {
  if (!pendingDeleteId.value || deleteBusyId.value) return
  pendingDeleteId.value = null
  const target = deleteTrigger
  deleteTrigger = null
  nextTick(() => target?.isConnected && target.focus())
}

async function confirmShelfDelete(item) {
  if (deleteBusyId.value || pendingDeleteId.value !== item.id) return
  deleteBusyId.value = item.id
  shelfError.value = ''
  shelfStatus.value = ''
  try {
    if (!props.deleteShelfItem) throw new Error('Удаление шаблонов недоступно')
    await props.deleteShelfItem(item.id)
    pendingDeleteId.value = null
    deleteTrigger = null
    shelfStatus.value = `Шаблон «${item.title}» удалён`
    await nextTick()
    presetSearchInput.value?.focus()
  } catch (error) {
    shelfError.value = errorText(error, 'Не удалось удалить шаблон')
  } finally {
    deleteBusyId.value = null
  }
}

function onFormKeydown(event) {
  if (event.key !== 'Escape') return
  if (pendingDeleteId.value && !deleteBusyId.value) {
    event.preventDefault()
    event.stopPropagation()
    cancelShelfDelete()
    return
  }
  if (isEditingShelf.value && !shelfBusy.value) {
    event.preventDefault()
    event.stopPropagation()
    cancelShelfEdit()
  }
}

function submit() {
  if (isEditingShelf.value) {
    saveShelfChanges()
    return
  }
  if (shelfBusy.value) return
  const t = title.value.trim()
  if (!t) return
  const fuse = Number(hours.value) || 24
  const payload = {
    title: t,
    emoji: emoji.value,
    base_points: Number(points.value) || 10,
    hours: fuse,
    repeat: repeat.value,
    interval_hours: repeat.value ? Number(intervalHours.value) || fuse : undefined
  }
  emit('add', payload)
  saveAddDefaults({
    emoji: payload.emoji,
    base_points: payload.base_points,
    hours: payload.hours,
    interval_hours: positiveFiniteNumber(intervalHours.value) ?? payload.hours,
    repeat: payload.repeat
  })
  title.value = ''
  emojiTouched.value = false
  metricsTouched.value = false
  flash.value = true
  setTimeout(() => (flash.value = false), 600)
  titleInput.value?.focus()
}

watch(
  [() => props.familyShelf, shelfBusy, deleteBusyId],
  ([items]) => {
    const ids = new Set((items ?? []).map(item => item.id))
    if (pendingDeleteId.value && !ids.has(pendingDeleteId.value) && !deleteBusyId.value) {
      pendingDeleteId.value = null
      deleteTrigger = null
      shelfError.value = ''
      shelfStatus.value = 'Шаблон уже удалён на другом устройстве'
    }
    if (editingId.value && !ids.has(editingId.value) && !shelfBusy.value) {
      finishShelfEdit()
      shelfStatus.value = ''
      shelfError.value = 'Шаблон удалён на другом устройстве'
    }
  }
)
</script>

<template>
  <section class="adder" :class="{ open, flash }">
    <button
      class="adder-toggle"
      type="button"
      :aria-expanded="open"
      aria-controls="add-task-form"
      :disabled="shelfBusy || deleteBusyId !== null"
      @click="toggle"
    >
      {{ open ? '✕ Свернуть' : '+ Новое дело' }}
    </button>
    <Transition name="drop">
      <form
        v-if="open"
        id="add-task-form"
        class="adder-form"
        :aria-busy="shelfBusy || deleteBusyId !== null"
        @submit.prevent="submit"
        @keydown="onFormKeydown"
      >
        <div v-if="isEditingShelf" class="shelf-edit-banner" role="status">
          <span>Изменение шаблона</span>
          <strong>{{ editingLabel }}</strong>
        </div>

        <input
          ref="titleInput"
          v-model="title"
          class="adder-title"
          placeholder="Что нужно сделать?"
          maxlength="80"
          :aria-label="isEditingShelf ? 'Название шаблона' : 'Название дела'"
          :disabled="shelfBusy"
        />

        <div
          class="preset-shelf"
          role="group"
          aria-label="Шаблоны дел"
          :aria-busy="deleteBusyId !== null"
        >
          <div class="preset-shelf-head">
            <span class="preset-shelf-label">Быстрый выбор</span>
            <input
              ref="presetSearchInput"
              v-model="presetQuery"
              class="preset-search"
              type="search"
              placeholder="Поиск…"
              aria-label="Поиск шаблонов"
              :disabled="shelfBusy || deleteBusyId !== null"
            />
          </div>

          <section class="family-shelf" aria-labelledby="family-shelf-title">
            <div class="family-shelf-head">
              <span id="family-shelf-title" class="preset-shelf-label">Наша полка</span>
              <span v-if="familyShelf.length" class="family-shelf-count">
                {{ familyShelf.length }}
              </span>
            </div>

            <div v-if="visibleFamilyShelf.length" class="family-shelf-list" role="list">
              <div
                v-for="item in visibleFamilyShelf"
                :key="`family:${item.id}`"
                class="family-preset-row"
                role="listitem"
              >
                <template v-if="pendingDeleteId !== item.id">
                  <button
                    type="button"
                    class="family-preset-apply"
                    :disabled="interactionLocked"
                    :aria-label="`Применить шаблон «${item.title}»`"
                    @click="applyFamilyPreset(item)"
                  >
                    <span class="family-preset-emoji" aria-hidden="true">{{ item.emoji }}</span>
                    <span class="family-preset-title">{{ item.title }}</span>
                  </button>
                  <button
                    type="button"
                    class="family-preset-action"
                    :disabled="interactionLocked"
                    :aria-label="`Изменить шаблон «${item.title}»`"
                    title="Изменить"
                    @click="startShelfEdit(item, $event)"
                  >
                    <span aria-hidden="true">✎</span>
                  </button>
                  <button
                    type="button"
                    class="family-preset-action danger"
                    :disabled="interactionLocked"
                    :aria-label="`Удалить шаблон «${item.title}»`"
                    title="Удалить"
                    @click="beginShelfDelete(item, $event)"
                  >
                    <span aria-hidden="true">🗑</span>
                  </button>
                </template>

                <div
                  v-else
                  class="family-delete-confirm"
                  role="group"
                  :aria-label="`Подтверждение удаления шаблона «${item.title}»`"
                >
                  <span class="family-delete-copy">
                    Удалить «{{ item.title }}»?
                    <small>Дела в очереди останутся.</small>
                  </span>
                  <button
                    :ref="element => setDeleteCancelRef(item.id, element)"
                    type="button"
                    class="family-confirm-btn"
                    :disabled="deleteBusyId === item.id"
                    @click="cancelShelfDelete"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    class="family-confirm-btn danger"
                    :disabled="deleteBusyId === item.id"
                    @click="confirmShelfDelete(item)"
                  >
                    {{ deleteBusyId === item.id ? 'Удаление…' : 'Удалить' }}
                  </button>
                </div>
              </div>
            </div>
            <p v-else-if="!familyShelf.length" class="preset-empty family-empty">
              На полке пока нет шаблонов. Заполните форму и сохраните первый.
            </p>
            <p v-else class="preset-empty family-empty">На полке ничего не найдено.</p>
          </section>

          <div class="builtin-shelf-head">
            <span class="preset-shelf-label">Готовые шаблоны</span>
          </div>
          <div class="chips preset-groups" aria-label="Категории готовых шаблонов">
            <button
              v-for="g in PRESET_GROUPS"
              :key="g.id"
              type="button"
              class="chip"
              :class="{ sel: groupId === g.id }"
              :aria-pressed="groupId === g.id"
              :disabled="interactionLocked"
              @click="groupId = g.id"
            >
              {{ g.label }}
            </button>
          </div>
          <div class="chips preset-list">
            <button
              v-for="p in visiblePresets"
              :key="p.id"
              type="button"
              class="chip preset-chip"
              :title="`${p.title} · ${p.base_points} оч. · ${p.hours}ч${p.repeat ? ' · 🔁' : ''}`"
              :disabled="interactionLocked"
              @click="applyPreset(p)"
            >
              {{ p.emoji }} {{ p.title }}
            </button>
            <span v-if="!visiblePresets.length" class="preset-empty">Ничего не найдено.</span>
          </div>
        </div>

        <div class="chips emoji-chips" role="group" aria-label="Эмодзи">
          <button
            v-for="e in emojis"
            :key="e"
            type="button"
            class="chip"
            :class="{ sel: emoji === e }"
            :aria-pressed="emoji === e"
            :aria-label="`эмодзи ${e}`"
            :disabled="shelfBusy"
            @click="onEmojiPick(e)"
          >
            {{ e }}
          </button>
        </div>

        <div class="row">
          <label>Размер</label>
          <div class="chips" role="group" aria-label="Размер дела">
            <button
              v-for="s in SIZE_PRESETS"
              :key="s.id"
              type="button"
              class="chip"
              :class="{ sel: sizeId === s.id }"
              :aria-pressed="sizeId === s.id"
              :title="`${formatPoints(s.base_points)}, ${s.hours}ч`"
              :disabled="shelfBusy"
              @click="applySize(s.id)"
            >
              {{ s.emoji }} {{ s.label }}
            </button>
          </div>
        </div>

        <div class="row">
          <label for="adder-points">Очки</label>
          <div class="chips">
            <button
              v-for="p in pointChips"
              :key="p"
              type="button"
              class="chip"
              :class="{ sel: points === p }"
              :aria-pressed="points === p"
              :disabled="shelfBusy"
              @click="onPointsPick(p)"
            >
              {{ p }}
            </button>
            <input
              id="adder-points"
              v-model.number="points"
              class="chip-input"
              type="number"
              min="1"
              max="1000"
              aria-label="Очки"
              :disabled="shelfBusy"
              @input="onPointsInput"
            />
          </div>
        </div>
        <div class="row">
          <label for="adder-hours">Сгорит через</label>
          <div class="chips">
            <button
              v-for="h in hourChips"
              :key="h.v"
              type="button"
              class="chip"
              :class="{ sel: hours === h.v }"
              :aria-pressed="hours === h.v"
              :disabled="shelfBusy"
              @click="onHoursPick(h.v)"
            >
              {{ h.l }}
            </button>
            <input
              id="adder-hours"
              v-model.number="hours"
              class="chip-input"
              type="number"
              min="0.1"
              max="720"
              step="any"
              title="часов до сгорания"
              aria-label="Часов до сгорания"
              :disabled="shelfBusy"
              @input="onHoursInput"
            />
          </div>
        </div>
        <div class="row">
          <label>Повтор</label>
          <div class="chips">
            <button
              type="button"
              class="chip repeat-chip"
              :class="{ sel: repeat }"
              :aria-pressed="repeat"
              title="после выполнения или сгорания дело вернётся в очередь"
              :disabled="shelfBusy"
              @click="toggleRepeat"
            >
              🔁 повторять
            </button>
          </div>
        </div>
        <div v-if="repeat" class="row">
          <label>Повтор через</label>
          <div class="chips">
            <button
              v-for="h in hourChips"
              :key="'iv' + h.v"
              type="button"
              class="chip"
              :class="{ sel: intervalHours === h.v }"
              :aria-pressed="intervalHours === h.v"
              :disabled="shelfBusy"
              @click="onIntervalPick(h.v)"
            >
              {{ h.l }}
            </button>
            <input
              v-model.number="intervalHours"
              class="chip-input"
              type="number"
              min="0.1"
              max="720"
              step="any"
              title="часов до следующего появления"
              aria-label="Часов до следующего появления"
              :disabled="shelfBusy"
              @input="onIntervalInput"
            />
          </div>
        </div>

        <div v-if="isEditingShelf" class="adder-actions">
          <button
            class="adder-submit"
            :disabled="!canPersistShelf || shelfBusy"
          >
            {{ shelfBusy ? 'Сохранение…' : 'Сохранить изменения' }}
          </button>
          <button
            type="button"
            class="shelf-secondary-btn"
            :disabled="shelfBusy"
            @click="cancelShelfEdit"
          >
            Отмена
          </button>
        </div>
        <div v-else class="adder-actions">
          <button
            class="adder-submit"
            :disabled="!title.trim() || interactionLocked"
          >
            Добавить в очередь 🚀
          </button>
          <button
            type="button"
            class="shelf-secondary-btn"
            :disabled="!canPersistShelf || interactionLocked"
            @click="saveToShelf"
          >
            {{ shelfBusy ? 'Сохранение…' : 'Сохранить на полку' }}
          </button>
        </div>

        <p v-if="shelfError" class="shelf-feedback error" role="alert">
          {{ shelfError }}
        </p>
        <p v-else-if="shelfStatus" class="shelf-feedback" role="status" aria-live="polite">
          {{ shelfStatus }}
        </p>
      </form>
    </Transition>
  </section>
</template>

<style scoped>
.shelf-edit-banner {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 11px;
  border: 1px solid rgba(122, 162, 247, 0.45);
  border-radius: 10px;
  background: rgba(122, 162, 247, 0.12);
  font-size: 13px;
}

.shelf-edit-banner span,
.family-shelf-count,
.family-delete-copy small {
  color: var(--muted);
}

.shelf-edit-banner strong,
.family-preset-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.family-shelf {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.family-shelf-head,
.builtin-shelf-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.family-shelf-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.family-shelf-list {
  display: flex;
  max-height: 176px;
  overflow-y: auto;
  flex-direction: column;
  gap: 6px;
}

.family-preset-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px 40px;
  gap: 5px;
  align-items: stretch;
}

.family-preset-apply,
.family-preset-action,
.family-confirm-btn,
.shelf-secondary-btn {
  border: 1px solid var(--card-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font: inherit;
}

.family-preset-apply {
  display: flex;
  min-width: 0;
  min-height: 40px;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  text-align: left;
}

.family-preset-emoji {
  flex: 0 0 auto;
  font-size: 17px;
}

.family-preset-title {
  flex: 1;
  font-size: 13px;
  font-weight: 650;
}

.family-preset-action {
  min-width: 40px;
  min-height: 40px;
  border-radius: 10px;
  font-size: 16px;
}

.family-preset-action.danger,
.family-confirm-btn.danger,
.shelf-feedback.error {
  color: var(--danger);
}

.family-preset-apply:hover:not(:disabled),
.family-preset-action:hover:not(:disabled),
.family-confirm-btn:hover:not(:disabled),
.shelf-secondary-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.1);
}

.family-delete-confirm {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
  align-items: center;
  padding: 6px;
  border: 1px solid rgba(255, 94, 108, 0.42);
  border-radius: 10px;
  background: rgba(255, 94, 108, 0.08);
}

.family-delete-copy {
  min-width: 0;
  padding: 2px 4px;
  overflow-wrap: anywhere;
  font-size: 12.5px;
}

.family-delete-copy small {
  display: block;
  margin-top: 2px;
  font-size: 11px;
}

.family-confirm-btn {
  min-height: 36px;
  padding: 6px 9px;
  border-radius: 8px;
  font-size: 12px;
}

.family-empty {
  margin: 0;
  line-height: 1.4;
}

.builtin-shelf-head {
  margin-top: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--card-border);
}

.adder-actions {
  display: flex;
  gap: 8px;
}

.adder-actions .adder-submit {
  flex: 1 1 auto;
}

.shelf-secondary-btn {
  min-height: 44px;
  padding: 9px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
}

.shelf-feedback {
  margin: -3px 2px 0;
  color: #8affc1;
  font-size: 12.5px;
  line-height: 1.35;
}

:is(button, input):focus-visible {
  outline: 2px solid #ffd166;
  outline-offset: 2px;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 480px) {
  .preset-shelf-head {
    flex-wrap: wrap;
  }

  .preset-search {
    width: 100%;
    max-width: none;
    min-height: 44px;
  }

  .family-preset-row {
    grid-template-columns: minmax(0, 1fr) 44px 44px;
  }

  .family-preset-apply,
  .family-preset-action,
  .family-confirm-btn {
    min-height: 44px;
  }

  .family-delete-confirm {
    grid-template-columns: 1fr 1fr;
  }

  .family-delete-copy {
    grid-column: 1 / -1;
  }

  .adder-actions {
    flex-direction: column;
  }
}
</style>
