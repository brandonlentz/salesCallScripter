import { contextBridge, ipcRenderer } from 'electron'

const api = {
  training: {
    listTranscripts: () => ipcRenderer.invoke('training:list-transcripts'),
    loadTranscript: (id) => ipcRenderer.invoke('training:load-transcript', id)
  },
  suggestions: {
    get: (transcriptText, callType, property) =>
      ipcRenderer.invoke('suggestions:get', { transcriptText, callType, property })
  },
  properties: {
    list: () => ipcRenderer.invoke('properties:list'),
    search: (query) => ipcRenderer.invoke('properties:search', query),
    save: (data) => ipcRenderer.invoke('properties:save', data),
    update: (id, data) => ipcRenderer.invoke('properties:update', { id, data }),
    delete: (id) => ipcRenderer.invoke('properties:delete', id)
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
    }
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
