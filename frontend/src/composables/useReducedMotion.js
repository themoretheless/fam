/** Respect prefers-reduced-motion; collapse animation durations. */
export const REDUCED =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function dur(ms) {
  return REDUCED ? 1 : ms
}
