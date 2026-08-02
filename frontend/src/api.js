import * as localApi from './localApi.js'

export const IS_LOCAL_DEMO = import.meta.env.VITE_FAM_API_MODE === 'local'

async function request(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || response.statusText)
  }
  if (response.status === 204) return null
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

const remoteApi = {
  fetchState: () => request('/api/state'),
  createTask: task => request('/api/tasks', json('POST', task)),
  createShelfItem: item => request('/api/shelf', json('POST', item)),
  updateShelfItem: (id, item) =>
    request(`/api/shelf/${encodeURIComponent(id)}`, json('PUT', item)),
  deleteShelfItem: id =>
    request(`/api/shelf/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createMemorableDate: item => request('/api/memorable-dates', json('POST', item)),
  updateMemorableDate: (id, item) =>
    request(`/api/memorable-dates/${encodeURIComponent(id)}`, json('PUT', item)),
  deleteMemorableDate: id =>
    request(`/api/memorable-dates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  claimTask: (id, playerId) =>
    request(`/api/tasks/${id}/claim`, json('POST', { player_id: playerId })),
  deleteTask: id => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  renamePlayer: (id, name) => request(`/api/players/${id}`, json('PATCH', { name })),
  reactEvent: (id, playerId, emoji) =>
    request(`/api/events/${id}/react`, json('POST', { player_id: playerId, emoji }))
}

const api = IS_LOCAL_DEMO ? localApi : remoteApi

export const fetchState = api.fetchState
export const createTask = api.createTask
export const createShelfItem = api.createShelfItem
export const updateShelfItem = api.updateShelfItem
export const deleteShelfItem = api.deleteShelfItem
export const createMemorableDate = api.createMemorableDate
export const updateMemorableDate = api.updateMemorableDate
export const deleteMemorableDate = api.deleteMemorableDate
export const claimTask = api.claimTask
export const deleteTask = api.deleteTask
export const renamePlayer = api.renamePlayer
export const reactEvent = api.reactEvent

export const localDemoWritesSupported = IS_LOCAL_DEMO
  ? localApi.localDemoWritesSupported
  : () => true

export const resetDemoState = IS_LOCAL_DEMO
  ? localApi.resetDemoState
  : async () => {
      throw new Error('Сброс доступен только в браузерном демо')
    }
