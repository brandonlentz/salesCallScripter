import { contextBridge, ipcRenderer } from 'electron'

const api = {
  training: {
    listTranscripts: () => ipcRenderer.invoke('training:list-transcripts'),
    loadTranscript: (id) => ipcRenderer.invoke('training:load-transcript', id)
  },
  suggestions: {
    // Additional bridge methods (system-audio capture control, etc.) will be
    // added here as the live-call pipeline lands.
    get: (transcriptText, callType) =>
      ipcRenderer.invoke('suggestions:get', { transcriptText, callType })
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
