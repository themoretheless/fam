<script setup>
import { formatPoints, ruPlural } from '../utils.js'
import { CHART } from '../composables/useStats.js'

defineProps({
  open: Boolean,
  armed: Boolean,
  chartBars: { type: Array, default: () => [] },
  chartActivity: { type: Array, default: () => [] },
  seasons: { type: Array, default: () => [] },
  p1: { type: Object, required: true },
  p2: { type: Object, required: true },
  weekDone: { type: Object, required: true },
  weekBurned: { type: Number, default: 0 },
  weekDailyBalance: { type: Array, default: () => [] },
  avgMult: { type: Number, default: null },
  firefightersWeek: { type: Number, default: 0 },
  bestDay: { type: Object, default: null },
  totalXp: { type: Number, default: 0 }
})

const emit = defineEmits(['close'])
</script>

<template>
  <Transition name="stats">
    <div v-if="open" class="stats-overlay" @click.self="emit('close')">
      <div class="stats-card" role="dialog" aria-modal="true" aria-label="Статистика">
        <button class="stats-close" type="button" aria-label="Закрыть" @click="emit('close')">✕</button>
        <h2>📊 Статистика</h2>

        <div class="stats-chart">
          <h3>Очки по дням, 14 дней</h3>
          <svg
            class="stats-bars"
            :class="{ armed }"
            :viewBox="`0 0 ${CHART.w} ${CHART.h}`"
            role="img"
            aria-label="Очки по дням за последние 14 дней"
          >
            <g v-for="(b, i) in chartBars" :key="b.label">
              <rect
                class="bar bar-p1"
                :x="b.p1.x"
                :y="CHART.h - CHART.labelH - b.p1.h"
                :width="CHART.barW"
                :height="b.p1.h"
                rx="2"
                :style="{ transitionDelay: `${i * 30}ms` }"
              />
              <rect
                class="bar bar-p2"
                :x="b.p2.x"
                :y="CHART.h - CHART.labelH - b.p2.h"
                :width="CHART.barW"
                :height="b.p2.h"
                rx="2"
                :style="{ transitionDelay: `${i * 30 + 15}ms` }"
              />
              <text v-if="i % 2 === 0" class="stats-day-label" :x="b.labelX" :y="CHART.h - 4" text-anchor="middle">
                {{ b.label }}
              </text>
            </g>
          </svg>
          <div class="stats-legend">
            <span class="legend-item"><i class="dot dot-p1"></i>{{ p1.name }}</span>
            <span class="legend-item"><i class="dot dot-p2"></i>{{ p2.name }}</span>
          </div>
          <p class="stats-activity">
            Сделано / сгорело:
            <span v-for="d in chartActivity.slice(-7)" :key="d.label" class="stats-act-day">
              {{ d.label }}: {{ d.doneCount }}/{{ d.burnedCount }}
            </span>
          </p>
        </div>

        <div v-if="seasons.length" class="stats-seasons">
          <h3>Сезоны</h3>
          <table>
            <thead>
              <tr>
                <th>Неделя</th>
                <th>{{ p1.name }}</th>
                <th>{{ p2.name }}</th>
                <th>Итог</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in seasons"
                :key="s.week_key"
                :class="{
                  'win-p1': s.winner === 'p1',
                  'win-p2': s.winner === 'p2'
                }"
              >
                <td>{{ s.week_key }}</td>
                <td>{{ s.p1_score }}</td>
                <td>{{ s.p2_score }}</td>
                <td>
                  <template v-if="s.winner === 'p1'">👑 {{ p1.name }}</template>
                  <template v-else-if="s.winner === 'p2'">👑 {{ p2.name }}</template>
                  <template v-else>ничья</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="stats-tiles">
          <div class="stats-tile">
            <span class="stats-tile-cap">Сделано за неделю</span>
            <b>{{ p1.name }}: {{ weekDone.p1 }} · {{ p2.name }}: {{ weekDone.p2 }}</b>
          </div>
          <div class="stats-tile">
            <span class="stats-tile-cap">Сгорело за неделю</span>
            <b>{{ weekBurned }}</b>
          </div>
          <div class="stats-tile">
            <span class="stats-tile-cap">Средний множитель</span>
            <b>{{ avgMult != null ? `×${avgMult.toFixed(2)}` : '—' }}</b>
          </div>
          <div class="stats-tile">
            <span class="stats-tile-cap">🚒 Пожарные</span>
            <b>{{ firefightersWeek }}</b>
          </div>
          <div class="stats-tile">
            <span class="stats-tile-cap">Лучший день</span>
            <b>{{ bestDay ? `${bestDay.label} · ${formatPoints(bestDay.total)}` : 'пока нет' }}</b>
          </div>
          <div class="stats-tile">
            <span class="stats-tile-cap">Всего XP за всё время</span>
            <b>{{ totalXp }}</b>
          </div>
        </div>

        <details class="stats-daily">
          <summary>Баланс по дням</summary>
          <div v-if="weekDailyBalance.length" class="stats-daily-scroll">
            <table aria-label="Баланс завершённых дел за текущую UTC-неделю">
              <thead>
                <tr>
                  <th scope="col">Дата</th>
                  <th scope="col">{{ p1.name }}</th>
                  <th scope="col">{{ p2.name }}</th>
                  <th scope="col">Сгорело</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="day in weekDailyBalance" :key="day.date">
                  <th scope="row">{{ day.label }}</th>
                  <td>
                    {{ day.p1.doneCount }}
                    {{ ruPlural(day.p1.doneCount, 'дело', 'дела', 'дел') }} ·
                    {{ formatPoints(day.p1.awardedPoints) }}
                  </td>
                  <td>
                    {{ day.p2.doneCount }}
                    {{ ruPlural(day.p2.doneCount, 'дело', 'дела', 'дел') }} ·
                    {{ formatPoints(day.p2.awardedPoints) }}
                  </td>
                  <td>{{ day.burnedCount }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="stats-daily-empty">За эту неделю пока нет завершённых дел.</p>
        </details>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.stats-daily {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--card-border);
}

.stats-daily summary {
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.stats-daily-scroll {
  margin-top: 10px;
  overflow-x: auto;
}

.stats-daily table {
  width: 100%;
  min-width: 500px;
  border-collapse: collapse;
  font-size: 12px;
}

.stats-daily th,
.stats-daily td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--card-border);
  text-align: left;
  white-space: nowrap;
}

.stats-daily th {
  color: var(--muted);
  font-weight: 600;
}

.stats-daily-empty {
  margin-top: 10px;
  color: var(--muted);
  font-size: 13px;
}
</style>
