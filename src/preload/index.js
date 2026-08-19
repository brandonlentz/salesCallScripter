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
    call: (phoneNumber) => ipcRenderer.invoke('dialer:call', phoneNumber)
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
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
