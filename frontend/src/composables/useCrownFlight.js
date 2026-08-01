import { watch } from 'vue'
import { REDUCED } from './useReducedMotion.js'

/** Animate 👑 between avatars when leader changes. */
export function useCrownFlight(leaderId) {
  let lastLeader = null

  watch(leaderId, (next, prev) => {
    if (prev == null || next == null || prev === next) {
      lastLeader = next
      return
    }
    if (REDUCED) {
      lastLeader = next
      return
    }
    const a = document.querySelector(`[data-player="${prev}"] .avatar`)
    const b = document.querySelector(`[data-player="${next}"] .avatar`)
    if (!a || !b) {
      lastLeader = next
      return
    }
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    const el = document.createElement('span')
    el.className = 'crown-flight'
    el.textContent = '👑'
    el.style.left = `${ra.left + ra.width / 2}px`
    el.style.top = `${ra.top}px`
    document.body.appendChild(el)
    const anim = el.animate(
      [
        { transform: 'translate(-50%,0) scale(1)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${rb.left - ra.left}px), ${rb.top - ra.top - 8}px) scale(1.2)`,
          opacity: 1,
          offset: 0.85
        },
        {
          transform: `translate(calc(-50% + ${rb.left - ra.left}px), ${rb.top - ra.top}px) scale(1)`,
          opacity: 0.2
        }
      ],
      { duration: 650, easing: 'cubic-bezier(.34,1.2,.64,1)' }
    )
    anim.onfinish = anim.oncancel = () => el.remove()
    lastLeader = next
  })

  return { lastLeader: () => lastLeader }
}
