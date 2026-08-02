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
  offlineMessage: { type: String, default: '' },
  demoMode: Boolean,
  demoWritesSupported: { type: Boolean, default: true },
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
  'reset-demo',
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
    <div v-if="demoMode" class="demo-notice" role="status">
      <span>
        <b>Публичное демо</b> · не вводите приватные данные · без синхронизации
      </span>
      <button type="button" class="demo-reset" @click="emit('reset-demo')">Сбросить</button>
      <small>
        Данные остаются в этом браузере; другие страницы на themoretheless.github.io могут
        прочитать их здесь.
      </small>
      <small v-if="!demoWritesSupported">
        Этот браузер поддерживает только просмотр: безопасное сохранение недоступно.
      </small>
    </div>
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
    <span v-if="offline" class="offline">
      ⚠️ {{ offlineMessage || (demoMode ? 'локальное хранилище недоступно' : 'нет связи с сервером') }}
    </span>
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

.demo-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 7px 10px;
  width: fit-content;
  max-width: min(100%, 620px);
  margin: 10px auto 0;
  padding: 8px 10px;
  border: 1px solid rgba(122, 162, 247, 0.45);
  border-radius: 14px;
  background: rgba(122, 162, 247, 0.12);
  color: var(--text);
  font-size: 13px;
}

.demo-notice small {
  flex-basis: 100%;
  color: var(--muted);
}

.demo-reset {
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid var(--card-border);
  border-radius: 9px;
  background: var(--card);
  color: inherit;
  font: inherit;
}

.demo-reset:hover {
  border-color: rgba(122, 162, 247, 0.75);
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
