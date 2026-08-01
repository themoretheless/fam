// Звуковые эффекты на WebAudio: без файлов, всё синтезируется на лету.
// Контекст создаётся лениво при первом воспроизведении (обычно из клика),
// так что политика автоплея браузера его сразу разблокирует.

const KEY = 'fam-muted'

let muted = false
try {
  muted = localStorage.getItem(KEY) === '1'
} catch {
  // localStorage недоступен (приватный режим): просто не сохраняем состояние.
}

export function isMuted() {
  return muted
}

export function toggleMute() {
  muted = !muted
  try {
    localStorage.setItem(KEY, muted ? '1' : '0')
  } catch {
    // Не сохранилось - не страшно, вернёмся к значению по умолчанию при перезагрузке.
  }
  return muted
}

let ctx = null
let master = null

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.18
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** Вызвать на pointerdown (свайп/тап), чтобы iOS разблокировал WebAudio до async claim. */
export function unlockAudio() {
  return ensureCtx()
}

// Одна нота: осциллятор + огибающая (атака ~5мс, экспоненциальный спад).
// exponentialRamp не принимает 0, поэтому затухаем до 0.0001.
function note(c, { freq, at, dur = 0.18, type = 'sine', vol = 1, endFreq = null }) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(vol, at + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(g).connect(master)
  osc.start(at)
  osc.stop(at + dur + 0.05)
}

// Яркое мажорное арпеджио C5-E5-G5, ~0.35с: звук обычного клейма.
export function playClaim() {
  if (muted) return
  const c = ensureCtx()
  if (!c) return
  const t0 = c.currentTime
  const freqs = [523.25, 659.25, 783.99]
  freqs.forEach((freq, i) => {
    const at = t0 + i * 0.09
    note(c, { freq, at, dur: 0.18, type: 'sine', vol: 0.9 })
    note(c, { freq, at, dur: 0.18, type: 'triangle', vol: 0.35 })
  })
}

// Быстрое восходящее арпеджио из 4 нот C5-E5-G5-C6: клейм с комбо.
export function playCombo() {
  if (muted) return
  const c = ensureCtx()
  if (!c) return
  const t0 = c.currentTime
  const freqs = [523.25, 659.25, 783.99, 1046.5]
  freqs.forEach((freq, i) => {
    const at = t0 + i * 0.06
    const vol = i === freqs.length - 1 ? 1 : 0.9
    note(c, { freq, at, dur: 0.15, type: 'sine', vol })
    note(c, { freq, at, dur: 0.15, type: 'triangle', vol: 0.35 })
  })
}

// Сгорание: шумовой свип вниз через lowpass-фильтр + низкий "бух".
export function playBurn() {
  if (muted) return
  const c = ensureCtx()
  if (!c) return
  const t0 = c.currentTime

  const len = Math.floor(c.sampleRate * 0.5)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1

  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 1
  filter.frequency.setValueAtTime(3000, t0)
  filter.frequency.exponentialRampToValueAtTime(200, t0 + 0.5)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(0.7, t0 + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5)
  src.connect(filter).connect(g).connect(master)
  src.start(t0)
  src.stop(t0 + 0.55)

  note(c, { freq: 110, endFreq: 45, at: t0 + 0.03, dur: 0.3, type: 'sine', vol: 1 })
}

// Короткий "поп" при добавлении дела.
export function playAdd() {
  if (muted) return
  const c = ensureCtx()
  if (!c) return
  note(c, { freq: 880, endFreq: 440, at: c.currentTime, dur: 0.12, type: 'sine', vol: 0.8 })
}

// Фанфары из 4 нот G4-C5-E5-G5: новая ачивка.
export function playAchievement() {
  if (muted) return
  const c = ensureCtx()
  if (!c) return
  const t0 = c.currentTime
  const freqs = [392, 523.25, 659.25, 783.99]
  freqs.forEach((freq, i) => {
    const at = t0 + i * 0.12
    note(c, { freq, at, dur: 0.35, type: 'sine', vol: 0.9 })
    note(c, { freq, at, dur: 0.35, type: 'triangle', vol: 0.4 })
  })
  // Последняя нота дублируется октавой выше для блеска.
  note(c, { freq: 1567.98, at: t0 + 3 * 0.12, dur: 0.35, type: 'sine', vol: 0.3 })
}

// Короткий диссонансный "бзз" при ошибке: малая секунда 220/233 Гц.
export function playError() {
  if (muted) return
  const c = ensureCtx()
  if (!c) return
  const t0 = c.currentTime
  note(c, { freq: 220, at: t0, dur: 0.2, type: 'square', vol: 0.35 })
  note(c, { freq: 233, at: t0, dur: 0.2, type: 'square', vol: 0.35 })
}

// Рост уровня: короткий подъём, не путать с ачивкой.
export function playLevelUp() {
  if (muted) return
  const c = ensureCtx()
  if (!c) return
  const t0 = c.currentTime
  const seq = [523.25, 659.25, 783.99] // C5 E5 G5
  seq.forEach((freq, i) => {
    note(c, { freq, at: t0 + i * 0.08, dur: 0.22, type: 'triangle', vol: 0.7 })
    note(c, { freq: freq * 2, at: t0 + i * 0.08 + 0.04, dur: 0.15, type: 'sine', vol: 0.25 })
  })
}
