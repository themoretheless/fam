import { emberBurst } from '../confetti.js'
import { playBurn } from '../sounds.js'
import { REDUCED, dur } from './useReducedMotion.js'

/**
 * Task list TransitionGroup hooks + optimistic hide + burn detection.
 * leaveFx: id -> 'p1' | 'p2' | 'burn'
 * No deps on game state at init (bind via checkBurns args).
 */
export function useTaskListFx() {
  const leaveFx = new Map()
  const hiddenIds = new Set()

  function hideFor(id, ms = 8000) {
    hiddenIds.add(id)
    setTimeout(() => hiddenIds.delete(id), ms)
  }

  function checkBurns(tasks, now) {
    const expired = tasks.value.filter(t => t.deadline - now.value <= 0)
    if (!expired.length) return
    playBurn()
    for (const t of expired) {
      leaveFx.set(t.id, 'burn')
      hideFor(t.id)
    }
    tasks.value = tasks.value.filter(t => !hiddenIds.has(t.id))
  }

  function onEnter(el, done) {
    const delay = REDUCED ? 0 : Math.min((Number(el.dataset.index) || 0) * 70, 420)
    el.style.opacity = '0'
    el._enterTimer = setTimeout(() => {
      el.style.opacity = ''
      const anim = el.animate(
        [
          { transform: 'translateY(-46px) scale(.92)', opacity: 0 },
          { transform: 'translateY(6px) scale(1.02)', opacity: 1, offset: 0.7 },
          { transform: 'none', opacity: 1 }
        ],
        { duration: dur(500), easing: 'cubic-bezier(.34,1.56,.64,1)' }
      )
      anim.onfinish = done
    }, delay)
  }

  function onEnterCancelled(el) {
    clearTimeout(el._enterTimer)
    el.style.opacity = ''
  }

  function onLeave(el, done) {
    clearTimeout(el._enterTimer)
    el.style.opacity = ''
    const fx = leaveFx.get(el.dataset.id)
    leaveFx.delete(el.dataset.id)
    const r = el.getBoundingClientRect()
    el.style.position = 'fixed'
    el.style.left = `${r.left}px`
    el.style.top = `${r.top}px`
    el.style.width = `${r.width}px`
    el.style.margin = '0'
    el.style.zIndex = '60'
    el.style.pointerEvents = 'none'
    let anim
    if (fx === 'burn') {
      emberBurst(r.left + r.width / 2, r.top + r.height / 2)
      anim = el.animate(
        [
          { transform: 'none', opacity: 1, filter: 'none' },
          {
            transform: 'translateY(8px) rotate(1.5deg) scale(.98)',
            opacity: 1,
            filter: 'sepia(1) saturate(4) hue-rotate(-25deg) brightness(.9)',
            offset: 0.45
          },
          {
            transform: 'translateY(130px) rotate(6deg) scale(.55)',
            opacity: 0,
            filter: 'brightness(.15) blur(6px)'
          }
        ],
        { duration: dur(950), easing: 'cubic-bezier(.4,0,.8,1)' }
      )
    } else if (fx === 'p1' || fx === 'p2') {
      const dir = fx === 'p1' ? -1 : 1
      const target = document.querySelector(`[data-player="${fx}"]`)
      let dx = dir * window.innerWidth * 0.35
      let dy = -60
      if (target) {
        const tr = target.getBoundingClientRect()
        dx = tr.left + tr.width / 2 - (r.left + r.width / 2)
        dy = tr.top + 100 - r.top
      }
      anim = el.animate(
        [
          { transform: 'none', opacity: 1 },
          {
            transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(.8) rotate(${dir * 6}deg)`,
            opacity: 0.95,
            offset: 0.6
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(.15) rotate(${dir * 14}deg)`,
            opacity: 0
          }
        ],
        { duration: dur(650), easing: 'cubic-bezier(.5,-.2,.6,1)' }
      )
    } else {
      anim = el.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: 'scale(.85)', opacity: 0 }
        ],
        { duration: dur(300), easing: 'ease-in' }
      )
    }
    anim.onfinish = done
  }

  return { leaveFx, hiddenIds, hideFor, checkBurns, onEnter, onEnterCancelled, onLeave }
}
