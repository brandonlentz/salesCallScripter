import { ipcMain } from 'electron'
import { connectDeepgram } from './deepgram.js'
import { startRecording } from './recording.js'

// Wires up live-call transcription. Supports one Deepgram connection per
// named audio channel:
//   - single-mic mode: one channel ("mixed") carrying both voices, split
//     back into speakers via Deepgram diarization (a guess)
//   - dual-stream mode: two channels ("rep" from the real mic, "prospect"
//     from a BlackHole loopback device), each a dedicated single-speaker
//     stream — no guessing needed, the channel IS the speaker
// One call at a time, which matches how the app is actually used.
//
// Every call is also recorded to disk (see recording.js) — the same audio
// chunks already flowing to Deepgram are appended to per-channel files as
// they arrive, so this adds no extra IPC traffic.
export function registerLiveCallHandlers(getMainWindow, appRootDir) {
  const connections = new Map()
  let recording = null

  ipcMain.handle('live-call:start', async (_event, { channels, callType, property }) => {
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

    // Best-effort: a recording failure shouldn't stop the call itself —
    // transcription and coaching are already live — but the rep should
    // know a call went unrecorded.
    try {
      recording = await startRecording(appRootDir, { callType, channels, property })
    } catch (err) {
      recording = null
      getMainWindow()?.webContents.send('live-call:error', `Recording could not start: ${err.message}`)
    }
  })

  ipcMain.on('live-call:audio-chunk', (_event, { channel, chunk }) => {
    const buffer = Buffer.from(chunk)
    connections.get(channel)?.send(buffer)
    recording?.appendChunk(channel, buffer)
  })

  ipcMain.handle('live-call:stop', async (_event, { transcriptText } = {}) => {
    for (const connection of connections.values()) connection.close()
    connections.clear()

    if (recording) {
      const activeRecording = recording
      recording = null
      const { mergeError } = await activeRecording.finish({ transcriptText })
      if (mergeError) {
        getMainWindow()?.webContents.send(
          'live-call:error',
          `Recording saved, but merging into one file failed: ${mergeError}`
        )
      }
    }
  })
}
