<script setup>
import { computed, nextTick, ref } from 'vue'
import {
  IS_LOCAL_DEMO,
  createTask,
  createShelfItem,
  updateShelfItem,
  deleteShelfItem,
  createMemorableDate as createMemorableDateApi,
  updateMemorableDate as updateMemorableDateApi,
  deleteMemorableDate as deleteMemorableDateApi,
  localDemoWritesSupported,
  resetDemoState
} from './api.js'
import { localDateParts, upcomingMemorableDates } from './memorableDates.js'
import { playAdd } from './sounds.js'

import PlayerCard from './components/PlayerCard.vue'
import TaskCard from './components/TaskCard.vue'
import AddTaskForm from './components/AddTaskForm.vue'
import ScoreStrip from './components/ScoreStrip.vue'
import SeasonFinaleOverlay from './components/SeasonFinaleOverlay.vue'
import StatsModal from './components/StatsModal.vue'
import AppHeader from './components/AppHeader.vue'
import EventFeed from './components/EventFeed.vue'
import UnlockOverlay from './components/UnlockOverlay.vue'
import ComboOverlay from './components/ComboOverlay.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import OnboardNamesModal from './components/OnboardNamesModal.vue'
import EmptyQueue from './components/EmptyQueue.vue'
import ToastBanner from './components/ToastBanner.vue'
import MemorableDatesModal from './components/MemorableDatesModal.vue'

import { useTheme } from './composables/useTheme.js'
import { useDuel } from './composables/useDuel.js'
import { useComboWindow } from './composables/useComboWindow.js'
import { useLoadBalance } from './composables/useLoadBalance.js'
import { useToast } from './composables/useToast.js'
import { useUnlockQueue } from './composables/useUnlockQueue.js'
import { useTaskListFx } from './composables/useTaskListFx.js'
import { useFamSync } from './composables/useFamSync.js'
import { useSeasonFinale } from './composables/useSeasonFinale.js'
import { usePlayersView } from './composables/usePlayersView.js'
import { useStats } from './composables/useStats.js'
import { useFamMe } from './composables/useFamMe.js'
import { useSwipeCoach } from './composables/useSwipeCoach.js'
import { useQuietControls } from './composables/useQuietControls.js'
import { useCrownFlight } from './composables/useCrownFlight.js'
import { useAppModal } from './composables/useAppModal.js'
import { useOnboarding } from './composables/useOnboarding.js'
import { useComboOverlay } from './composables/useComboOverlay.js'
import { useClaim } from './composables/useClaim.js'
import { useMute } from './composables/useMute.js'

const { toast, showToast, dispose: disposeToast } = useToast()
const { unlock, enqueueUnlocks, nextUnlock, dispose: disposeUnlock } = useUnlockQueue()
const { leaveFx, hiddenIds, hideFor, checkBurns, onEnter, onEnterCancelled, onLeave } =
  useTaskListFx()
const { seasonFinale, applyWeekChange, closeFinale, dispose: disposeFinale } = useSeasonFinale({
  enqueueUnlocks
})

const {
  players,
  tasks,
  events,
  weekKey,
  seasons,
  now,
  offline,
  gains,
  achievements,
  history,
  familyShelf,
  memorableDates,
  syncError,
  markPlayersFresh,
  refresh,
  startLoop
} = useFamSync({
  hiddenIds,
  checkBurns: () => checkBurns(tasks, now),
  applyWeekChange
})

const demoWritesSupported = localDemoWritesSupported()

const { p1, p2, leaderId, seasonWins, achP1, achP2 } = usePlayersView(
  players,
  seasons,
  achievements
)
const sortedTasks = computed(() => [...tasks.value].sort((a, b) => a.deadline - b.deadline))
const memorableBadge = computed(() => {
  const [nearest] = upcomingMemorableDates(memorableDates.value, localDateParts(now.value), 1)
  const days = nearest?.occurrence?.daysUntil
  if (days === 0) return 'сегодня'
  if (days === 1) return 'завтра'
  return Number.isFinite(days) ? `${days} дн.` : ''
})

const {
  statsOpen,
  statsArmed,
  weekStart,
  chartBars,
  chartActivity,
  bestDay,
  totalXp,
  avgMult,
  firefightersWeek,
  openStats,
  closeStats
} = useStats({ history, now, p1, p2 })

const { weekDone, weekBurned, weekDailyBalance, weekShare, loadSkew } = useLoadBalance(
  history,
  weekStart
)
const { duelPct, seasonCountdown } = useDuel(p1, p2, now)
const { recordClaim, comboChip: comboChipAt } = useComboWindow()
function comboChip(id) {
  return comboChipAt(id, now.value)
}

const { muted, onToggleMute } = useMute()
const { theme: _theme, nextTheme, onToggleTheme } = useTheme()
const { quietCfg, notifPerm, onToggleQuiet, onEnableNotif } = useQuietControls()
const { swipeCoachSeen, onSwipeCoachDone } = useSwipeCoach()
const { famMe, setFamMe, onReact } = useFamMe({ events, showToast })
const { combo, showCombo, dispose: disposeCombo } = useComboOverlay()

useCrownFlight(leaderId)

const memorableDatesOpen = ref(false)
let memorableDatesTrigger = null

function openMemorableDates(event) {
  memorableDatesTrigger = event?.currentTarget ?? null
  memorableDatesOpen.value = true
}

function closeMemorableDates() {
  memorableDatesOpen.value = false
  const trigger = memorableDatesTrigger
  memorableDatesTrigger = null
  nextTick(() => trigger?.isConnected && trigger.focus())
}

const {
  modal,
  renameDraft,
  openRename,
  openDelete,
  closeModal,
  confirmDelete,
  confirmRename
} = useAppModal({
  players,
  tasks,
  hideFor,
  hiddenIds,
  showToast,
  refresh,
  markPlayersFresh
})

const {
  onboardNamesOpen,
  onboardNameP1,
  onboardNameP2,
  showPhoneHint,
  isFreshHome,
  starterBusy,
  dismissPhoneHint,
  maybeOpenOnboardNames,
  finishOnboardNames,
  submitOnboardNames,
  seedStarter
} = useOnboarding({
  p1,
  p2,
  sortedTasks,
  history,
  events,
  showToast,
  refresh
})

const { onClaim } = useClaim({
  tasks,
  players,
  gains,
  now,
  leaveFx,
  hideFor,
  hiddenIds,
  markPlayersFresh,
  recordClaim,
  showCombo,
  enqueueUnlocks,
  showToast,
  refresh
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (modal.value) {
    closeModal()
    return
  }
  if (onboardNamesOpen.value) {
    finishOnboardNames()
    return
  }
  if (seasonFinale.value) {
    closeFinale()
    return
  }
  if (unlock.value) {
    nextUnlock()
    return
  }
  if (memorableDatesOpen.value) {
    closeMemorableDates()
    return
  }
  closeStats()
}

startLoop({
  onTickExtra: {
    afterFirstRefresh: () => {
      if (!IS_LOCAL_DEMO) maybeOpenOnboardNames()
    },
    onMount: () => window.addEventListener('keydown', onKeydown),
    onUnmount: () => {
      window.removeEventListener('keydown', onKeydown)
      disposeToast()
      disposeUnlock()
      disposeFinale()
      disposeCombo()
    }
  }
})

async function onAdd(draft) {
  try {
    await createTask(draft)
    playAdd()
    await refresh()
  } catch (e) {
    showToast(e.message || 'Не получилось добавить дело')
    refresh()
  }
}

async function runShelfMutation(action, fallbackMessage) {
  try {
    const result = await action()
    await refresh()
    return result
  } catch (error) {
    showToast(error.message || fallbackMessage)
    refresh()
    throw error
  }
}

function onCreateShelfItem(draft) {
  return runShelfMutation(
    () => createShelfItem(draft),
    'Не удалось сохранить шаблон'
  )
}

function onUpdateShelfItem(id, draft) {
  return runShelfMutation(
    () => updateShelfItem(id, draft),
    'Не удалось обновить шаблон'
  )
}

function onDeleteShelfItem(id) {
  return runShelfMutation(
    () => deleteShelfItem(id),
    'Не удалось удалить шаблон'
  )
}

async function runMemorableMutation(action) {
  try {
    const result = await action()
    await refresh()
    return result
  } catch (error) {
    refresh()
    throw error
  }
}

function onCreateMemorableDate(draft) {
  return runMemorableMutation(() => createMemorableDateApi(draft))
}

function onUpdateMemorableDate(id, draft) {
  return runMemorableMutation(() => updateMemorableDateApi(id, draft))
}

function onDeleteMemorableDate(id) {
  return runMemorableMutation(() => deleteMemorableDateApi(id))
}

function onRemove(task) {
  openDelete(task)
}

function onRename(player) {
  openRename(player)
}

async function onResetDemo() {
  if (!window.confirm('Удалить все данные этого демо из текущего браузера?')) return
  try {
    await resetDemoState()
    await refresh()
    showToast('Демо сброшено')
  } catch (error) {
    showToast(error.message || 'Не удалось сбросить демо')
  }
}
</script>

<template>
  <div class="bg" aria-hidden="true">
    <i class="blob b1"></i>
    <i class="blob b2"></i>
    <i class="blob b3"></i>
  </div>

  <ToastBanner :message="toast" />
  <ComboOverlay :combo="combo" />

  <Transition name="combo">
    <SeasonFinaleOverlay
      v-if="seasonFinale"
      :finale="seasonFinale"
      :p1="p1"
      :p2="p2"
      @close="closeFinale"
    />
  </Transition>

  <UnlockOverlay :unlock="unlock" @next="nextUnlock" />

  <StatsModal
    :open="statsOpen"
    :armed="statsArmed"
    :chart-bars="chartBars"
    :chart-activity="chartActivity"
    :seasons="seasons"
    :p1="p1"
    :p2="p2"
    :week-done="weekDone"
    :week-burned="weekBurned"
    :week-daily-balance="weekDailyBalance"
    :avg-mult="avgMult"
    :firefighters-week="firefightersWeek"
    :best-day="bestDay"
    :total-xp="totalXp"
    @close="closeStats"
  />

  <MemorableDatesModal
    :open="memorableDatesOpen"
    :items="memorableDates"
    :now="now"
    :create-item="onCreateMemorableDate"
    :update-item="onUpdateMemorableDate"
    :delete-item="onDeleteMemorableDate"
    @close="closeMemorableDates"
  />

  <ConfirmModal
    :modal="modal"
    :rename-draft="renameDraft"
    @close="closeModal"
    @update:rename-draft="renameDraft = $event"
    @confirm-rename="confirmRename"
    @confirm-delete="confirmDelete"
  />

  <div class="layout">
    <AppHeader
      :muted="muted"
      :next-theme="nextTheme"
      :quiet-enabled="quietCfg.enabled"
      :notif-perm="notifPerm"
      :week-key="weekKey"
      :p1-score="p1.score"
      :p2-score="p2.score"
      :duel-pct="duelPct"
      :season-countdown="seasonCountdown"
      :offline="offline"
      :offline-message="syncError"
      :demo-mode="IS_LOCAL_DEMO"
      :demo-writes-supported="demoWritesSupported"
      :show-phone-hint="showPhoneHint && !IS_LOCAL_DEMO"
      :memorable-badge="memorableBadge"
      @toggle-mute="onToggleMute"
      @toggle-theme="onToggleTheme"
      @toggle-quiet="onToggleQuiet"
      @enable-notif="onEnableNotif"
      @open-stats="openStats"
      @open-memorable="openMemorableDates"
      @reset-demo="onResetDemo"
      @dismiss-phone-hint="dismissPhoneHint"
    />

    <OnboardNamesModal
      v-if="!IS_LOCAL_DEMO"
      :open="onboardNamesOpen"
      :p1="p1"
      :p2="p2"
      :name-p1="onboardNameP1"
      :name-p2="onboardNameP2"
      @update:name-p1="onboardNameP1 = $event"
      @update:name-p2="onboardNameP2 = $event"
      @later="finishOnboardNames"
      @submit="submitOnboardNames"
    />

    <ScoreStrip :p1="p1" :p2="p2" :leader-id="leaderId" />

    <PlayerCard
      class="area-p1"
      side="p1"
      :player="p1"
      :gain="gains.p1"
      :is-leader="leaderId === 'p1'"
      :season-wins="seasonWins('p1')"
      :week-key="weekKey"
      :achievements="achP1"
      :week-tasks="weekDone.p1"
      :week-share="weekShare('p1')"
      :week-burns="weekBurned"
      :load-skew="loadSkew && weekDone.p1 < weekDone.p2"
      :combo-chip="comboChip('p1')"
      data-player="p1"
      @rename="onRename"
    />

    <main class="area-queue">
      <AddTaskForm
        :family-shelf="familyShelf"
        :create-shelf-item="onCreateShelfItem"
        :update-shelf-item="onUpdateShelfItem"
        :delete-shelf-item="onDeleteShelfItem"
        @add="onAdd"
      />

      <TransitionGroup
        tag="div"
        class="task-list"
        :css="false"
        appear
        move-class="tasks-move"
        @enter="onEnter"
        @enter-cancelled="onEnterCancelled"
        @leave="onLeave"
      >
        <TaskCard
          v-for="(t, i) in sortedTasks"
          :key="t.id"
          :task="t"
          :now="now"
          :players="players"
          :show-swipe-coach="!swipeCoachSeen && i === 0"
          :data-id="t.id"
          :data-index="i"
          @claim="onClaim"
          @remove="onRemove"
          @swipe-coach-done="onSwipeCoachDone"
        />
      </TransitionGroup>

      <EmptyQueue
        v-if="!sortedTasks.length"
        :is-fresh-home="isFreshHome"
        :starter-busy="starterBusy"
        @seed="seedStarter"
      />

      <EventFeed
        :events="events"
        :now="now"
        :fam-me="famMe"
        :p1="p1"
        :p2="p2"
        @set-me="setFamMe"
        @react="onReact"
      />
    </main>

    <PlayerCard
      class="area-p2"
      side="p2"
      :player="p2"
      :gain="gains.p2"
      :is-leader="leaderId === 'p2'"
      :season-wins="seasonWins('p2')"
      :week-key="weekKey"
      :achievements="achP2"
      :week-tasks="weekDone.p2"
      :week-share="weekShare('p2')"
      :week-burns="weekBurned"
      :load-skew="loadSkew && weekDone.p2 < weekDone.p1"
      :combo-chip="comboChip('p2')"
      data-player="p2"
      @rename="onRename"
    />
  </div>
</template>
