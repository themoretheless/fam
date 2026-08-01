<script setup>
defineProps({
  p1Score: { type: Number, default: 0 },
  p2Score: { type: Number, default: 0 },
  pct: { type: Object, required: true },
  countdown: { type: String, required: true }
})
</script>

<template>
  <div class="duel-bar" aria-label="Дуэль сезона">
    <span class="duel-meta">{{ p1Score }}</span>
    <div class="duel-track" role="img" :aria-label="`доля ${pct.p1} процентов`">
      <div class="duel-p1" :style="{ width: pct.p1 + '%' }"></div>
      <div class="duel-p2" :style="{ width: pct.p2 + '%' }"></div>
    </div>
    <span class="duel-meta">{{ p2Score }}</span>
    <span class="duel-meta">до сброса {{ countdown }}</span>
  </div>
</template>
