import { contextBridge, ipcRenderer } from 'electron'

const api = {
  training: {
    listTranscripts: () => ipcRenderer.invoke('training:list-transcripts'),
    loadTranscript: (id) => ipcRenderer.invoke('training:load-transcript', id)
  },
  suggestions: {
    get: (transcriptText, callType, property, variantId) =>
      ipcRenderer.invoke('suggestions:get', { transcriptText, callType, property, variantId })
  },
  scriptVariants: {
    list: (callType) => ipcRenderer.invoke('scriptVariants:list', callType),
    get: (callType, id) => ipcRenderer.invoke('scriptVariants:get', { callType, id }),
    save: (callType, data) => ipcRenderer.invoke('scriptVariants:save', { callType, data }),
    delete: (callType, id) => ipcRenderer.invoke('scriptVariants:delete', { callType, id }),
    parse: (rawText) => ipcRenderer.invoke('scriptVariants:parse', rawText)
  },
  nepqReferences: {
    list: () => ipcRenderer.invoke('nepqReferences:list'),
    save: (data) => ipcRenderer.invoke('nepqReferences:save', data),
    delete: (id) => ipcRenderer.invoke('nepqReferences:delete', id),
    parse: (base64, filename) => ipcRenderer.invoke('nepqReferences:parse', { base64, filename })
  },
  properties: {
    list: () => ipcRenderer.invoke('properties:list'),
    search: (query) => ipcRenderer.invoke('properties:search', query),
    save: (data) => ipcRenderer.invoke('properties:save', data),
    update: (id, data) => ipcRenderer.invoke('properties:update', { id, data }),
    delete: (id) => ipcRenderer.invoke('properties:delete', id),
    parse: (rawText) => ipcRenderer.invoke('properties:parse', rawText)
  },
  dialer: {
    call: (phoneNumber) => ipcRenderer.invoke('dialer:call', phoneNumber),
    facetime: (phoneNumber) => ipcRenderer.invoke('dialer:facetime', phoneNumber),
    text: (phoneNumber) => ipcRenderer.invoke('dialer:text', phoneNumber)
  },
  callAnalysis: {
    analyze: (transcriptText, callType) =>
      ipcRenderer.invoke('callAnalysis:analyze', { transcriptText, callType })
  },
  recordings: {
    reveal: (dir) => ipcRenderer.invoke('recordings:reveal', dir)
  },
  liveCall: {
    start: (channels, meta) => ipcRenderer.invoke('live-call:start', { channels, ...meta }),
    stop: (transcriptText) => ipcRenderer.invoke('live-call:stop', { transcriptText }),
    sendAudioChunk: (channel, chunk) => ipcRenderer.send('live-call:audio-chunk', { channel, chunk }),
    onTranscript: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('live-call:transcript', listener)
      return () => ipcRenderer.removeListener('live-call:transcript', listener)
    },
    onError: (callback) => {
      const listener = (_event, message) => callback(message)
      ipcRenderer.on('live-call:error', listener)
      return () => ipcRenderer.removeListener('live-call:error', listener)
    },
    // Routine audiotap progress ("waiting for Phone to launch", "capturing
    // Phone") — separate from onError so the UI doesn't treat normal setup
    // as a failure. See liveCall.js.
    onAudiotapStatus: (callback) => {
      const listener = (_event, message) => callback(message)
      ipcRenderer.on('live-call:audiotap-status', listener)
      return () => ipcRenderer.removeListener('live-call:audiotap-status', listener)
    }
  },
  usage: {
    // One-shot pull of everything recorded so far — for seeding UI state on
    // mount, since the live push below only reaches a window that's already
    // listening (see usageTracker.js).
    get: () => ipcRenderer.invoke('usage:get'),
    // Fires on every Claude API call across the app (see usageTracker.js's
    // call sites) with the new event plus the updated running totals.
    onUpdate: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('usage:update', listener)
      return () => ipcRenderer.removeListener('usage:update', listener)
    }
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
