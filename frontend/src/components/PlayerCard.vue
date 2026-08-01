<script setup>
import { computed, ref, watch } from 'vue'
import { levelFromXp, levelTitle, levelProgress, formatPointsWord } from '../utils.js'
import { burst, levelBurstColors } from '../confetti.js'
import { playLevelUp } from '../sounds.js'

const props = defineProps({
  player: { type: Object, required: true },
  side: { type: String, required: true },
  gain: { type: Object, default: null },
  isLeader: { type: Boolean, default: false },
  seasonWins: { type: Number, default: 0 },
  weekKey: { type: String, default: '' },
  achievements: { type: Array, default: () => [] },
  /** Число done-дел за текущую неделю */
  weekTasks: { type: Number, default: 0 },
  /** Доля done 0..100 (null = нет данных) */
  weekShare: { type: Number, default: null },
  /** Общее число сгораний за неделю (одинаково обоим) */
  weekBurns: { type: Number, default: 0 },
  /** Мягкий сигнал перекоса нагрузки */
  loadSkew: { type: Boolean, default: false },
  /** { text, expiring } | null */
  comboChip: { type: Object, default: null }
})
const emit = defineEmits(['rename'])

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const displayScore = ref(props.player.score)
const bump = ref(false)
const loss = ref(false)
const floats = ref([])
let bumpTimer = null
let lossTimer = null

function pushFloat(text, kind) {
  const id = `${Date.now()}-${Math.random()}`
  floats.value.push({ id, text, kind })
  setTimeout(() => {
    floats.value = floats.value.filter(f => f.id !== id)
  }, 1600)
}

// Празднуем (твин + подпрыгивание) только собственный клейм, о котором говорит
// свежий gain; первый снапшот с сервера и чужие обновления показываем без шума.
// Падение счёта (штраф за сгорание) показываем красной вспышкой без твина.
// Недельный сброс (смена week_key) не наказание: обнуление показываем тихо.
let seenWeekKey = props.weekKey
watch(
  () => props.player.score,
  (next, prev) => {
    const weekChanged = props.weekKey !== seenWeekKey
    seenWeekKey = props.weekKey
    if (weekChanged) {
      displayScore.value = next ?? 0
      return
    }
    if (prev != null && next < prev) {
      displayScore.value = next ?? 0
      loss.value = true
      clearTimeout(lossTimer)
      lossTimer = setTimeout(() => (loss.value = false), 900)
      pushFloat(`-${prev - next}`, 'loss')
      return
    }
    const recentGain = props.gain && Date.now() - props.gain.ts < 1500
    if (recentGain && !REDUCED) tween(displayScore.value, next ?? 0)
    else displayScore.value = next ?? 0
  }
)

function tween(from, to) {
  if (from === to) {
    displayScore.value = to
    return
  }
  bump.value = true
  clearTimeout(bumpTimer)
  bumpTimer = setTimeout(() => (bump.value = false), 900)
  const start = performance.now()
  const dur = 800
  function step(t) {
    const p = Math.min((t - start) / dur, 1)
    const eased = 1 - Math.pow(1 - p, 3)
    displayScore.value = Math.round(from + (to - from) * eased)
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// Регистрируем ПОСЛЕ вотчера счёта: при одновременном обновлении пропсов
// вотчер счёта успевает увидеть смену недели до синхронизации seenWeekKey.
watch(
  () => props.weekKey,
  v => { seenWeekKey = v }
)

watch(
  () => props.gain?.ts,
  () => {
    if (!props.gain) return
    pushFloat(`+${props.gain.points}`, 'gain')
  }
)

// ---------- Уровни из пожизненного xp ----------

const RING_R = 52
const RING_C = 2 * Math.PI * RING_R

const xp = computed(() => Math.max(Number(props.player.xp) || 0, 0))
const level = computed(() => levelFromXp(xp.value))
const title = computed(() => levelTitle(level.value))
const progress = computed(() => levelProgress(xp.value))
const dashOffset = computed(() => RING_C * (1 - progress.value))

const avatarEl = ref(null)
const levelFlash = ref(false)
const levelFloats = ref([]) // отдельно от флоатов счёта, чтобы не мешались
let flashTimer = null

// Празднуем только реальный рост уровня. App.vue сначала монтирует карточку
// с плейсхолдером без xp (level 1), и первый снапшот с сервера выглядит как
// скачок 1 -> N: гейтим по hadRealXp, чтобы не было ложного салюта на загрузке.
let hadRealXp = props.player.xp !== undefined
watch(level, (next, prev) => {
  const isReal = props.player.xp !== undefined
  if (!hadRealXp) {
    hadRealXp = isReal
    return
  }
  if (prev === undefined || next <= prev) return
  playLevelUp()
  // текст показываем всегда (он информативный), эффекты гейтим по REDUCED
  const id = `lvl-${Date.now()}-${Math.random()}`
  levelFloats.value.push({ id, text: `УРОВЕНЬ ${next}!` })
  setTimeout(() => {
    levelFloats.value = levelFloats.value.filter(f => f.id !== id)
  }, 1800)
  if (REDUCED) return
  levelFlash.value = true
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (levelFlash.value = false), 1200)
  const el = avatarEl.value
  if (el) {
    const r = el.getBoundingClientRect()
    burst(r.left + r.width / 2, r.top + r.height / 2, levelBurstColors())
  }
})
</script>

<template>
  <aside class="player" :class="[`side-${side}`, { bump, loss }]">
    <div class="avatar-wrap" ref="avatarEl" :class="{ 'level-flash': levelFlash }">
      <svg class="level-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="level-ring-track" cx="60" cy="60" r="52" />
        <circle
          class="level-ring-fill"
          cx="60" cy="60" r="52"
          :stroke-dasharray="RING_C"
          :stroke-dashoffset="dashOffset"
        />
      </svg>
      <div class="avatar" :class="{ bounce: bump, shake: loss }">
        <Transition name="crown">
          <span v-if="isLeader" class="crown">👑</span>
        </Transition>
        {{ player.avatar }}
      </div>
      <span v-for="f in levelFloats" :key="f.id" class="float-level">{{ f.text }}</span>
    </div>
    <button
      type="button"
      class="pname"
      :aria-label="`Переименовать: ${player.name}`"
      title="Нажми, чтобы переименовать"
      @click="emit('rename', player)"
    >
      {{ player.name }} <span class="pencil" aria-hidden="true">✏️</span>
    </button>
    <div class="level-cap">ур. {{ level }} · {{ title }}</div>
    <div class="xp-line">{{ xp }} XP</div>
    <div class="score-wrap">
      <div class="score" :class="{ pop: bump }">{{ displayScore }}</div>
      <div class="score-cap">{{ formatPointsWord(displayScore) }}</div>
      <span v-for="f in floats" :key="f.id" class="float-pts" :class="{ loss: f.kind === 'loss' }">{{ f.text }}</span>
    </div>
    <div
      v-if="weekShare != null || weekTasks > 0"
      class="load-line"
      :class="{ skew: loadSkew }"
      :title="loadSkew ? 'Перекос нагрузки за неделю' : 'Доля дел за неделю'"
    >
      дела {{ weekTasks }}{{ weekShare != null ? ` (${weekShare}%)` : '' }}
      <span v-if="weekBurns > 0"> · 🔥 {{ weekBurns }}</span>
      <span v-if="loadSkew"> · ⚖️</span>
    </div>
    <div v-if="comboChip" class="combo-chip" :class="{ expiring: comboChip.expiring }">
      {{ comboChip.text }}
    </div>
    <div v-if="achievements.length" class="badges">
      <span v-for="a in achievements" :key="a.id" class="badge" :title="a.title">{{ a.emoji }}</span>
    </div>
    <div v-if="seasonWins > 0" class="season-wins">🏆 сезонов: {{ seasonWins }}</div>
  </aside>
</template>
