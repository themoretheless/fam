<script setup>
defineProps({
  p1: { type: Object, required: true },
  p2: { type: Object, required: true },
  leaderId: { type: String, default: null }
})
</script>

<template>
  <div class="score-strip" aria-label="Счёт">
    <div class="score-strip-side" :class="{ lead: leaderId === 'p1' }">
      <span class="score-strip-av">{{ p1.avatar }}</span>
      <span class="score-strip-name">{{ p1.name }}</span>
      <span class="score-strip-pts">{{ p1.score }}</span>
      <span v-if="leaderId === 'p1'" class="score-strip-crown" aria-hidden="true">👑</span>
    </div>
    <div class="score-strip-vs">·</div>
    <div class="score-strip-side" :class="{ lead: leaderId === 'p2' }">
      <span class="score-strip-av">{{ p2.avatar }}</span>
      <span class="score-strip-name">{{ p2.name }}</span>
      <span class="score-strip-pts">{{ p2.score }}</span>
      <span v-if="leaderId === 'p2'" class="score-strip-crown" aria-hidden="true">👑</span>
    </div>
  </div>
</template>
