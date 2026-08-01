async function j(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || res.statusText)
  }
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

export const fetchState = () => j('/api/state')
export const createTask = (task) => j('/api/tasks', json('POST', task))
export const createShelfItem = (item) => j('/api/shelf', json('POST', item))
export const updateShelfItem = (id, item) =>
  j(`/api/shelf/${encodeURIComponent(id)}`, json('PUT', item))
export const deleteShelfItem = (id) =>
  j(`/api/shelf/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const createMemorableDate = (item) => j('/api/memorable-dates', json('POST', item))
export const updateMemorableDate = (id, item) =>
  j(`/api/memorable-dates/${encodeURIComponent(id)}`, json('PUT', item))
export const deleteMemorableDate = (id) =>
  j(`/api/memorable-dates/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const claimTask = (id, player_id) => j(`/api/tasks/${id}/claim`, json('POST', { player_id }))
export const deleteTask = (id) => j(`/api/tasks/${id}`, { method: 'DELETE' })
export const renamePlayer = (id, name) => j(`/api/players/${id}`, json('PATCH', { name }))
export const reactEvent = (id, player_id, emoji) =>
  j(`/api/events/${id}/react`, json('POST', { player_id, emoji }))
