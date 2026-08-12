import { ipcMain } from 'electron'
import { connectDeepgram } from './deepgram.js'

// Wires up live-call transcription. Supports one Deepgram connection per
// named audio channel:
//   - single-mic mode: one channel ("mixed") carrying both voices, split
//     back into speakers via Deepgram diarization (a guess)
//   - dual-stream mode: two channels ("rep" from the real mic, "prospect"
//     from a BlackHole loopback device), each a dedicated single-speaker
//     stream — no guessing needed, the channel IS the speaker
// One call at a time, which matches how the app is actually used.
export function registerLiveCallHandlers(getMainWindow) {
  const connections = new Map()

  ipcMain.handle('live-call:start', async (_event, { channels }) => {
    const opened = []
    try {
      for (const channel of channels) {
        if (connections.has(channel)) continue

        const connection = connectDeepgram({
          onTranscript: (payload) =>
            getMainWindow()?.webContents.send('live-call:transcript', { channel, ...payload }),
          onError: (message) =>
            getMainWindow()?.webContents.send('live-call:error', `[${channel}] ${message}`),
          onClose: () => connections.delete(channel)
        })

        await connection.ready
        connections.set(channel, connection)
        opened.push(channel)
      }
    } catch (err) {
      // Roll back any channels we did manage to open before the failure.
      for (const channel of opened) {
        connections.get(channel)?.close()
        connections.delete(channel)
      }
      throw new Error(`Could not connect to Deepgram: ${err.message}`)
    }
  })

  ipcMain.on('live-call:audio-chunk', (_event, { channel, chunk }) => {
    connections.get(channel)?.send(Buffer.from(chunk))
  })

  ipcMain.handle('live-call:stop', () => {
    for (const connection of connections.values()) connection.close()
    connections.clear()
  })
}
