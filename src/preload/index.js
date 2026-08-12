import { contextBridge, ipcRenderer } from 'electron'

const api = {
  training: {
    listTranscripts: () => ipcRenderer.invoke('training:list-transcripts'),
    loadTranscript: (id) => ipcRenderer.invoke('training:load-transcript', id)
  },
  suggestions: {
    get: (transcriptText, callType) =>
      ipcRenderer.invoke('suggestions:get', { transcriptText, callType })
  },
  liveCall: {
    start: (channels) => ipcRenderer.invoke('live-call:start', { channels }),
    stop: () => ipcRenderer.invoke('live-call:stop'),
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
