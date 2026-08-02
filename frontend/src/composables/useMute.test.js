import { beforeEach, describe, expect, it, vi } from 'vitest'

const soundMocks = vi.hoisted(() => ({
  isMuted: vi.fn(),
  toggleMute: vi.fn()
}))

vi.mock('../sounds.js', () => soundMocks)

import { useMute } from './useMute.js'

describe('useMute', () => {
  beforeEach(() => {
    soundMocks.isMuted.mockReset().mockReturnValue(false)
    soundMocks.toggleMute.mockReset()
  })

  it('updates the reactive UI state on every toggle', () => {
    const { muted, onToggleMute } = useMute()

    onToggleMute()
    expect(muted.value).toBe(true)

    onToggleMute()
    expect(muted.value).toBe(false)
    expect(soundMocks.toggleMute).toHaveBeenCalledTimes(2)
  })
})
