// Палитры частиц зависят от темы: неон и белый, читаемые на тёмном фоне,
// на светлой бумаге невидимы, а в графитовом стиле неуместны.
const PALETTES = {
  dark: {
    p1: ['#ff9e64', '#ffd166', '#ff5e7e', '#ffe9a0', '#ffffff'],
    p2: ['#7aa2f7', '#7bdff2', '#b388ff', '#a0e9ff', '#ffffff'],
    level: ['#ffd166', '#ffe9a0', '#ffb347', '#fff2c9', '#ffffff']
  },
  paper: {
    p1: ['#d96f2e', '#b8860b', '#c94f43', '#e0a050', '#8a5a30'],
    p2: ['#3f6fb5', '#2f8a8a', '#7a5aa0', '#5a86c5', '#3a5a80'],
    level: ['#b8860b', '#d9a441', '#c98a2e', '#7a5b10', '#e0b45a']
  },
  sketch: {
    p1: ['#55524b', '#7a766b', '#a46b3c', '#8c6f52', '#4a463d'],
    p2: ['#55524b', '#7a766b', '#5f7d9c', '#6d83a1', '#4a463d'],
    level: ['#7d6a45', '#8a867c', '#55524b', '#9a8555', '#6d6a62']
  }
}

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches

function palette() {
  return PALETTES[document.documentElement.dataset.theme] ?? PALETTES.dark
}

export function playerColors(playerId) {
  return playerId === 'p1' ? palette().p1 : palette().p2
}

export function levelBurstColors() {
  return palette().level
}

// Конфетти-залп в точке (x, y) в координатах вьюпорта.
export function burst(x, y, colors) {
  if (REDUCED) return
  const wrap = document.createElement('div')
  wrap.className = 'fx-wrap'
  wrap.style.left = `${x}px`
  wrap.style.top = `${y}px`
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('i')
    s.className = 'fx-confetti'
    const angle = Math.random() * Math.PI * 2
    const dist = 60 + Math.random() * 170
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    s.style.setProperty('--dy', `${Math.sin(angle) * dist - 90}px`)
    s.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`)
    s.style.background = colors[i % colors.length]
    s.style.animationDuration = `${0.7 + Math.random() * 0.6}s`
    wrap.appendChild(s)
  }
  document.body.appendChild(wrap)
  setTimeout(() => wrap.remove(), 1500)
}

// Огоньки и дым при сгорании дела.
export function emberBurst(x, y) {
  if (REDUCED) return
  const wrap = document.createElement('div')
  wrap.className = 'fx-wrap'
  wrap.style.left = `${x}px`
  wrap.style.top = `${y}px`
  const glyphs = ['🔥', '🔥', '🔥', '✨', '💨', '💨']
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span')
    s.className = 'fx-ember'
    s.textContent = glyphs[i % glyphs.length]
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`)
    s.style.setProperty('--dy', `${-40 - Math.random() * 160}px`)
    s.style.fontSize = `${12 + Math.random() * 16}px`
    s.style.animationDuration = `${0.8 + Math.random() * 0.7}s`
    s.style.animationDelay = `${Math.random() * 0.15}s`
    wrap.appendChild(s)
  }
  document.body.appendChild(wrap)
  setTimeout(() => wrap.remove(), 1800)
}
