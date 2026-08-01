<script setup>
import { THEME_META } from '../composables/useTheme.js'
import DuelBar from './DuelBar.vue'

defineProps({
  muted: Boolean,
  nextTheme: { type: String, required: true },
  quietEnabled: Boolean,
  notifPerm: { type: String, default: 'unsupported' },
  weekKey: { type: String, default: '' },
  p1Score: { type: Number, default: 0 },
  p2Score: { type: Number, default: 0 },
  duelPct: { type: Object, default: null },
  seasonCountdown: { type: String, default: '' },
  offline: Boolean,
  showPhoneHint: Boolean,
  memorableBadge: { type: String, default: '' }
})

const emit = defineEmits([
  'toggle-mute',
  'toggle-theme',
  'toggle-quiet',
  'enable-notif',
  'open-stats',
  'open-memorable',
  'dismiss-phone-hint'
])
</script>

<template>
  <header class="header">
    <button
      class="mute-btn"
      type="button"
      :aria-label="muted ? 'Включить звук' : 'Выключить звук'"
      :title="muted ? 'Включить звук' : 'Выключить звук'"
      @click="emit('toggle-mute')"
    >{{ muted ? '🔇' : '🔊' }}</button>
    <button
      class="theme-btn"
      type="button"
      :aria-label="`Переключить стиль: ${THEME_META[nextTheme].title}`"
      :title="THEME_META[nextTheme].title"
      @click="emit('toggle-theme')"
    >{{ THEME_META[nextTheme].icon }}</button>
    <button
      class="quiet-btn"
      type="button"
      :aria-pressed="quietEnabled"
      :title="quietEnabled ? 'Тихие часы вкл (22–08)' : 'Тихие часы выкл'"
      @click="emit('toggle-quiet')"
    >{{ quietEnabled ? '🌙' : '☀️' }}</button>
    <button
      v-if="notifPerm !== 'unsupported'"
      class="notif-btn"
      type="button"
      :title="notifPerm === 'granted' ? 'Уведомления включены' : 'Включить уведомления'"
      @click="emit('enable-notif')"
    >{{ notifPerm === 'granted' ? '🔔' : '🔕' }}</button>
    <h1>🏡 Наш быт</h1>
    <p>кто сделал – того и очки · чем дольше дело висит, тем оно дороже</p>
    <p v-if="weekKey" class="season-line">сезон {{ weekKey }}</p>
    <DuelBar
      v-if="weekKey && duelPct"
      :p1-score="p1Score"
      :p2-score="p2Score"
      :pct="duelPct"
      :countdown="seasonCountdown"
    />
    <div class="header-actions">
      <button class="stats-btn" type="button" @click="emit('open-stats')">📊 Статистика</button>
      <button
        class="stats-btn memorable-btn"
        type="button"
        :aria-label="memorableBadge ? `Памятные даты, ближайшая дата — ${memorableBadge}` : 'Памятные даты'"
        @click="emit('open-memorable', $event)"
      >
        📅 Даты
        <span v-if="memorableBadge" class="memorable-badge">{{ memorableBadge }}</span>
      </button>
    </div>
    <span v-if="offline" class="offline">⚠️ нет связи с сервером</span>
    <div v-if="showPhoneHint" class="phone-hint">
      <span>📱 С телефона в той же Wi‑Fi: адрес компьютера в сети и порт 7878</span>
      <button type="button" class="phone-hint-x" aria-label="Скрыть" @click="emit('dismiss-phone-hint')">×</button>
    </div>
  </header>
</template>

<style scoped>
.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.memorable-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.memorable-badge {
  min-width: 24px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 209, 102, 0.2);
  color: #ffd166;
  font-size: 11px;
  line-height: 1.35;
}

@media (max-width: 480px) {
  .header-actions :deep(.stats-btn) {
    min-height: 44px;
  }
}
</style>
