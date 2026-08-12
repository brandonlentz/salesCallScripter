import { ipcMain } from 'electron'
import { connectDeepgram } from './deepgram.js'

// Wires up a single live-call transcription session: renderer streams mic
// audio chunks in, we forward them to Deepgram, and push transcript events
// back out. One call at a time, which matches how the app is actually used.
export function registerLiveCallHandlers(getMainWindow) {
  let connection = null

  ipcMain.handle('live-call:start', async () => {
    if (connection) return

    connection = connectDeepgram({
      onTranscript: (payload) => getMainWindow()?.webContents.send('live-call:transcript', payload),
      onError: (message) => getMainWindow()?.webContents.send('live-call:error', message),
      onClose: () => {
        connection = null
      }
    })

    try {
      await connection.ready
    } catch (err) {
      connection = null
      throw new Error(`Could not connect to Deepgram: ${err.message}`)
    }
  })

  ipcMain.on('live-call:audio-chunk', (_event, chunk) => {
    connection?.send(Buffer.from(chunk))
  })

  ipcMain.handle('live-call:stop', () => {
    connection?.close()
    connection = null
  })
}
