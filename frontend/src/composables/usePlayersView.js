import { computed } from 'vue'

/** Derived player views: p1/p2, leader, season wins, ach split. */
export function usePlayersView(players, seasons, achievements) {
  const p1 = computed(
    () => players.value.find(p => p.id === 'p1') ?? { id: 'p1', name: '…', avatar: '🦊', score: 0 }
  )
  const p2 = computed(
    () => players.value.find(p => p.id === 'p2') ?? { id: 'p2', name: '…', avatar: '🐻‍❄️', score: 0 }
  )
  const leaderId = computed(() => {
    if (p1.value.score === p2.value.score) return null
    return p1.value.score > p2.value.score ? 'p1' : 'p2'
  })
  const seasonWins = id => seasons.value.filter(s => s.winner === id).length
  const achP1 = computed(() => achievements.value.filter(a => a.player_id === 'p1'))
  const achP2 = computed(() => achievements.value.filter(a => a.player_id === 'p2'))

  return { p1, p2, leaderId, seasonWins, achP1, achP2 }
}
