import { ipcMain } from 'electron'
import { connectDeepgram } from './deepgram.js'
import { startRecording } from './recording.js'
import { startAudioTapCapture, AUDIO_TAP_SAMPLE_RATE } from './audioTap.js'

// The 'prospect' channel's format when it comes from the native audiotap
// helper instead of a browser MediaRecorder stream — headerless raw PCM,
// not a self-describing container, so both Deepgram and the recording file
// writer need to be told the format explicitly (see deepgram.js/recording.js).
const NATIVE_TAP_CHANNEL_FORMAT = {
  prospect: {
    ext: 'raw',
    ffmpegArgs: ['-f', 's16le', '-ar', String(AUDIO_TAP_SAMPLE_RATE), '-ac', '1']
  }
}

// Wires up live-call transcription: one Deepgram connection per channel,
// "rep" (real mic, browser MediaRecorder) and "prospect" (native audiotap
// helper — see audioTap.js), each a dedicated single-speaker stream — no
// diarization guessing needed, the channel IS the speaker. One call at a
// time, which matches how the app is actually used.
//
// Every call is also recorded to disk (see recording.js) — the same audio
// chunks already flowing to Deepgram are appended to per-channel files as
// they arrive, so this adds no extra IPC traffic.
//
// Ending is manual only (End Call in the UI) — an earlier version tried to
// auto-detect hangup from a volume heuristic, but that risked ending a call
// early during a real, long silence (a rep on hold, a long thinking pause),
// which is worse than just requiring one click. Starting stays automatic —
// see LiveCallPanel.jsx's dialSignal handling — only ending was reverted.
export function registerLiveCallHandlers(getMainWindow, appRootDir) {
  const connections = new Map()
  let recording = null
  let audioTap = null
  let callActive = false
  // Channels currently in a reconnect-failure streak — used to alert the UI
  // once when reconnecting starts failing, not on every retry (a real outage
  // would otherwise spam an error every second).
  const reconnectFailing = new Set()

  // Opens (or re-opens) a Deepgram connection for one channel and registers it in
  // `connections`. Deepgram routinely closes connections that aren't our own
  // doing — e.g. it closes idle connections after ~10-12s with no audio, and
  // in native-tap mode the 'prospect' connection opens as soon as the call
  // starts but can sit idle while the phone is still ringing, before real
  // caller audio arrives. These are expected and silently recovered (retried
  // after a short delay, mirroring the respawn pattern audioTap.js already
  // uses for the native helper) — only a reconnect that itself fails reaches
  // the UI, since that's the case that actually needs the rep's attention.
  async function openChannel(channel, options) {
    const connection = connectDeepgram({
      onTranscript: (payload) => getMainWindow()?.webContents.send('live-call:transcript', { channel, ...payload }),
      onError: (message) => {
        console.error(`[deepgram ${channel}] error:`, message)
        getMainWindow()?.webContents.send('live-call:error', `[${channel}] ${message}`)
      },
      onClose: (wasIntentional) => {
        console.log(`[deepgram ${channel}] closed${wasIntentional ? ' (intentional)' : ' unexpectedly'}`)
        connections.delete(channel)
        if (callActive && !wasIntentional) setTimeout(() => reconnectChannel(channel, options), 1000)
      },
      ...options
    })
    await connection.ready
    connections.set(channel, connection)
    reconnectFailing.delete(channel) // a successful (re)connect clears any earlier failure streak
    return connection
  }

  function reconnectChannel(channel, options) {
    if (!callActive || connections.has(channel)) return
    console.log(`[deepgram ${channel}] reconnecting`)
    openChannel(channel, options).catch((err) => {
      console.error(`[deepgram ${channel}] reconnect failed:`, err.message)
      if (!reconnectFailing.has(channel)) {
        reconnectFailing.add(channel)
        getMainWindow()?.webContents.send(
          'live-call:error',
          `[${channel}] Lost connection and could not reconnect: ${err.message}`
        )
      }
      if (callActive) setTimeout(() => reconnectChannel(channel, options), 1000)
    })
  }

  ipcMain.handle(
    'live-call:start',
    async (_event, { channels, callType, property, nativeAudioTap }) => {
      console.log('[live-call:start]', { channels, callType, nativeAudioTap })
      reconnectFailing.clear()
      const opened = []
      try {
        for (const channel of channels) {
          if (connections.has(channel)) continue

          // 'prospect' comes from the native audiotap helper — headerless
          // linear16 PCM. 'rep' is still a browser MediaRecorder webm/opus
          // blob, which Deepgram auto-detects with no extra params.
          const options = channel === 'prospect' ? { encoding: 'linear16', sampleRate: AUDIO_TAP_SAMPLE_RATE } : {}

          await openChannel(channel, options)
          opened.push(channel)
        }
        callActive = true
      } catch (err) {
        console.error('[live-call:start] Deepgram connect failed:', err)
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
        recording = await startRecording(appRootDir, {
          callType,
          channels,
          property,
          channelFormats: NATIVE_TAP_CHANNEL_FORMAT
        })
      } catch (err) {
        recording = null
        getMainWindow()?.webContents.send('live-call:error', `Recording could not start: ${err.message}`)
      }

      // 'prospect' chunks come from this spawned helper, not a
      // live-call:audio-chunk IPC message from the renderer — there's no
      // browser MediaStream for it at all. Feed the same Deepgram-connection
      // / recording fan-out the IPC handler below uses.
      let gotFirstChunk = false
      audioTap = startAudioTapCapture(appRootDir, {
        processName: nativeAudioTap.processName,
        onData: (buffer) => {
          if (!gotFirstChunk) {
            gotFirstChunk = true
            console.log('[audiotap] first audio chunk received:', buffer.length, 'bytes')
          }
          connections.get('prospect')?.send(buffer)
          recording?.appendChunk('prospect', buffer)
        },
        // Status lines ("waiting for Phone to launch", "capturing Phone")
        // are routine, not alarming — a separate channel from
        // live-call:error so the UI doesn't flash a red error banner for
        // normal setup. Real failures (helper missing, unexpected crash)
        // still go to live-call:error.
        onStatus: (message) => {
          console.log('[audiotap status]', message)
          getMainWindow()?.webContents.send('live-call:audiotap-status', message)
        },
        onError: (message) => {
          console.error('[audiotap error]', message)
          getMainWindow()?.webContents.send('live-call:error', `[audiotap] ${message}`)
        }
      })
    }
  )

  ipcMain.on('live-call:audio-chunk', (_event, { channel, chunk }) => {
    const buffer = Buffer.from(chunk)
    connections.get(channel)?.send(buffer)
    recording?.appendChunk(channel, buffer)
  })

  ipcMain.handle('live-call:stop', async (_event, { transcriptText } = {}) => {
    callActive = false // before closing, so onClose doesn't schedule a reconnect
    audioTap?.stop()
    audioTap = null

    for (const connection of connections.values()) connection.close()
    connections.clear()

    if (!recording) return { dir: null, mergeError: null }

    const activeRecording = recording
    recording = null
    const { dir, mergeError } = await activeRecording.finish({ transcriptText })
    if (mergeError) {
      getMainWindow()?.webContents.send(
        'live-call:error',
        `Recording saved, but merging into one file failed: ${mergeError}`
      )
    }
    return { dir, mergeError }
  })
}
