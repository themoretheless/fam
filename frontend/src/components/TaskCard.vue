<script setup>
import { computed, ref } from 'vue'
import { formatDuration, formatPointsWord } from '../utils.js'
import { unlockAudio } from '../sounds.js'

const props = defineProps({
  task: { type: Object, required: true },
  now: { type: Number, required: true },
  players: { type: Array, default: () => [] },
  /** Показать one-shot coach свайпа (только первая карточка) */
  showSwipeCoach: { type: Boolean, default: false }
})
const emit = defineEmits(['claim', 'remove', 'swipe-coach-done'])

const total = computed(() => Math.max(props.task.deadline - props.task.created_at, 1))
const remaining = computed(() => Math.max(props.task.deadline - props.now, 0))
const fraction = computed(() => remaining.value / total.value)
const elapsedRatio = computed(() =>
  Math.min(Math.max(props.now - props.task.created_at, 0), total.value) / total.value
)
// Та же формула, что на сервере: x1.0 при создании, x3.0 у дедлайна.
const mult = computed(() => 1 + 2 * elapsedRatio.value)
const points = computed(() => Math.round(props.task.base_points * mult.value))

const urgent = computed(
  () => remaining.value > 0 && remaining.value < Math.min(total.value * 0.15, 15 * 60 * 1000)
)
const critical = computed(() => remaining.value > 0 && remaining.value < 60 * 1000)
const timeLeft = computed(() => formatDuration(remaining.value))

const hue = computed(() => Math.round(140 * fraction.value))
const fuseStyle = computed(() => ({
  width: `${Math.max(fraction.value * 100, 0.5)}%`,
  background: `hsl(${hue.value} 85% 55%)`,
  color: `hsl(${hue.value} 85% 55%)`
}))

function nameOf(id) {
  return props.players.find(p => p.id === id)?.name ?? '…'
}

// Стабильный «рукописный» наклон карточки для бумажной темы: из хеша id,
// а не из позиции в списке, чтобы наклон не перескакивал при пересортировке.
const tiltVar = computed(() => {
  let h = 0
  for (const ch of props.task.id) h = (h * 31 + ch.charCodeAt(0)) | 0
  const t = (((h % 100) + 100) % 100) / 100
  return { '--tilt': `${(t * 0.9 - 0.45).toFixed(2)}deg` }
})

// --- Свайп: влево = клейм за p1, вправо = за p2 (мышь и тач через Pointer Events) ---

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const dur = ms => (REDUCED ? 1 : ms)

const cardEl = ref(null)
const dragging = ref(false)
const dx = ref(0)
let startX = 0
let startY = 0
let pointerId = null // не null = pointerdown получен, следим за жестом
let springAnim = null // летящая анимация возврата, отменяем при новом захвате
let suppressClick = false // после активного драга гасим следующий click (в некоторых движках он прилетает в кнопку)

const dragStyle = computed(() =>
  dragging.value
    ? { transform: `translateX(${dx.value}px) rotate(${dx.value * 0.03}deg)`, transition: 'none' }
    : null
)
const swipeTarget = computed(() => (dragging.value ? (dx.value < 0 ? 'p1' : 'p2') : null))

function claimThreshold() {
  const w = cardEl.value?.clientWidth || 360
  return Math.max(72, Math.min(140, w * 0.28))
}

const swipeOpacity = computed(() => Math.min(Math.abs(dx.value) / (claimThreshold() * 1.25), 1))

function onPointerDown(e) {
  suppressClick = false // флаг живёт только до следующего pointerdown: клик мог и не прилететь
  if (e.button !== 0 || pointerId !== null) return
  // Кнопки и поля живут своей жизнью: жест с них не начинаем.
  if (e.target.closest('button, input, textarea, select, a')) return
  unlockAudio()
  if (springAnim) {
    springAnim.cancel()
    springAnim = null
  }
  if (cardEl.value) cardEl.value.style.transform = ''
  startX = e.clientX
  startY = e.clientY
  pointerId = e.pointerId
  // Захват и preventDefault только после активации: обычные клики и скролл не трогаем.
}

function onPointerMove(e) {
  if (pointerId === null || e.pointerId !== pointerId) return
  const mx = e.clientX - startX
  const my = e.clientY - startY
  if (!dragging.value) {
    if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
      dragging.value = true
      try {
        cardEl.value?.setPointerCapture(pointerId)
      } catch {
        // указатель мог уже исчезнуть: жест просто не захватится
      }
    } else if (Math.abs(my) > 8 && Math.abs(my) >= Math.abs(mx)) {
      // Вертикальный жест: отдаём его скроллу.
      pointerId = null
      return
    } else {
      return
    }
  }
  dx.value = mx
  e.preventDefault()
}

function onPointerUp(e) {
  if (e.pointerId !== pointerId) return
  pointerId = null
  if (!dragging.value) return // обычный клик: пусть дойдёт до кнопок
  suppressClick = true
  const delta = dx.value
  if (Math.abs(delta) >= claimThreshold()) {
    // Сбрасываем transform до эмита: leave-анимация мерит getBoundingClientRect.
    dragging.value = false
    dx.value = 0
    if (cardEl.value) {
      cardEl.value.style.transform = ''
      cardEl.value.style.transition = ''
    }
    try {
      if (navigator.vibrate) navigator.vibrate(12)
    } catch {
      // haptic недоступен
    }
    emit('swipe-coach-done')
    emit('claim', props.task, delta < 0 ? 'p1' : 'p2')
    return
  }
  springBack()
}

function dismissCoach() {
  emit('swipe-coach-done')
}

const repeatHint = computed(() => {
  const fuse = task_fuse_label()
  const iv = props.task.interval_hours ?? props.task.repeat_hours
  if (iv != null && fuse != null && Math.abs(iv - fuse) > 0.01) {
    return `фитиль ${fmtH(fuse)} · повтор ${fmtH(iv)}`
  }
  return 'повторяющееся дело'
})

function fmtH(h) {
  if (h >= 24 && h % 24 === 0) return `${h / 24}д`
  return `${h}ч`
}

function task_fuse_label() {
  if (props.task.fuse_hours) return props.task.fuse_hours
  const span = (props.task.deadline - props.task.created_at) / 3_600_000
  return span > 0 ? span : null
}

function onPointerCancel(e) {
  if (e.pointerId !== pointerId) return
  pointerId = null
  if (dragging.value) springBack()
}

function onClickCapture(e) {
  if (!suppressClick) return
  suppressClick = false
  e.stopPropagation()
  e.preventDefault()
}

function springBack() {
  const el = cardEl.value
  const from = `translateX(${dx.value}px) rotate(${dx.value * 0.03}deg)`
  dragging.value = false
  dx.value = 0
  if (!el) return
  el.style.transform = ''
  el.style.transition = ''
  springAnim = el.animate(
    [{ transform: from }, { transform: 'translateX(0) rotate(0deg)' }],
    { duration: dur(300), easing: 'cubic-bezier(.34,1.56,.64,1)' }
  )
  springAnim.onfinish = springAnim.oncancel = () => {
    springAnim = null
  }
}
</script>

<template>
  <article
    ref="cardEl"
    class="task"
    :class="{ urgent, critical, hot: mult >= 2, dragging }"
    :style="[tiltVar, dragStyle]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @click.capture="onClickCapture"
  >
    <div
      v-if="dragging"
      class="swipe-overlay"
      :class="swipeTarget"
      :style="{ opacity: swipeOpacity }"
      aria-hidden="true"
    >
      <span class="swipe-hint">{{ swipeTarget === 'p1' ? '← ' + nameOf('p1') : nameOf('p2') + ' →' }}</span>
    </div>
    <button class="del" title="Удалить дело" @click="emit('remove', task)">✕</button>
    <div class="task-head">
      <span class="task-emoji">{{ task.emoji }}</span>
      <h3 class="task-title">{{ task.title }}</h3>
      <span
        v-if="task.repeat_hours || task.interval_hours"
        class="repeat-badge"
        :title="repeatHint"
        aria-label="повторяющееся дело"
        >🔁</span
      >
      <div class="points" :class="{ blaze: mult >= 2 }">
        <span :key="points" class="pts-num">{{ points }}</span>
        <span class="pts-cap">{{ formatPointsWord(points) }} <b>×{{ mult.toFixed(1) }}</b></span>
      </div>
    </div>
    <div
      class="fuse"
      role="progressbar"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="Math.round(fraction * 100)"
      :aria-label="`До сгорания: ${timeLeft}`"
    >
      <div class="fuse-fill" :style="fuseStyle" aria-hidden="true"></div>
      <div class="fuse-scale" aria-hidden="true">
        <span class="fuse-mark" style="left: 0%">×1</span>
        <span class="fuse-mark" style="left: 50%">×2</span>
        <span class="fuse-mark" style="left: 100%">×3</span>
      </div>
    </div>
    <div class="task-meta">
      <span class="left-time">⏳ сгорит через {{ timeLeft }}</span>
      <span class="base">база {{ task.base_points }}</span>
    </div>
    <p v-if="showSwipeCoach" class="swipe-coach">
      ← {{ nameOf('p1') }} · свайп · {{ nameOf('p2') }} →
      <button type="button" class="swipe-coach-ok" @click="dismissCoach">Понятно</button>
    </p>
    <div class="claim-row">
      <button class="claim p1" @click="emit('claim', task, 'p1')">← {{ nameOf('p1') }}</button>
      <button class="claim p2" @click="emit('claim', task, 'p2')">{{ nameOf('p2') }} →</button>
    </div>
  </article>
</template>
