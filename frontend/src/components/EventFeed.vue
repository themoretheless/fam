<script setup>
import { formatAgo } from '../utils.js'

defineProps({
  events: { type: Array, default: () => [] },
  now: { type: Number, required: true },
  famMe: { type: String, default: null },
  p1: { type: Object, required: true },
  p2: { type: Object, required: true }
})

const emit = defineEmits(['set-me', 'react'])
</script>

<template>
  <div v-if="!famMe" class="fam-me-pick">
    Я:
    <button type="button" class="chip" @click="emit('set-me', 'p1')">{{ p1.avatar }} {{ p1.name }}</button>
    <button type="button" class="chip" @click="emit('set-me', 'p2')">{{ p2.avatar }} {{ p2.name }}</button>
  </div>
  <TransitionGroup v-if="events.length" name="feed" tag="ul" class="feed">
    <li v-for="e in events.slice(0, 8)" :key="e.id" :class="{ 'feed-season': e.kind === 'season' }">
      <div class="feed-main">
        <span class="feed-text">{{ e.text }}</span>
        <span class="feed-ago">{{ formatAgo(e.at, now) }}</span>
      </div>
      <div v-if="e.kind === 'done'" class="feed-react">
        <button
          v-for="em in ['🙏', '❤️', '🔥']"
          :key="em"
          type="button"
          class="react-chip"
          :disabled="!famMe"
          @click="emit('react', e, em)"
        >{{ em }}</button>
        <span
          v-for="r in e.reactions || []"
          :key="r.player_id + r.emoji"
          class="react-show"
          :title="r.player_id"
        >{{ r.emoji }}</span>
      </div>
    </li>
  </TransitionGroup>
</template>
