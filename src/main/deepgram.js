import WebSocket from 'ws'

// Streaming speech-to-text for live calls, via Deepgram. Runs in the main
// process so DEEPGRAM_API_KEY never touches the renderer.
//
// One connection per channel ("rep" from the real mic, "prospect" from the
// native audiotap helper — see liveCall.js/audioTap.js), each a dedicated
// single-speaker stream. `diarize: true` is harmless but unused here since
// the channel already identifies the speaker — kept on in case a
// single-channel/diarized mode is ever reintroduced.
const BASE_PARAMS = {
  model: 'nova-2',
  language: 'en-US',
  diarize: 'true',
  punctuate: 'true',
  smart_format: 'true',
  interim_results: 'true',
  utterance_end_ms: '1000',
  vad_events: 'true'
}
// No `encoding`/`container` param by default: the renderer sends
// MediaRecorder's audio/webm;codecs=opus blobs as-is, and Deepgram
// auto-detects the container from the stream (same as the validated
// call-tracker setup). The native audiotap helper (audioTap.js) instead
// sends headerless raw PCM, which Deepgram can't auto-detect — callers of
// connectDeepgram() for that channel pass `{ encoding: 'linear16',
// sampleRate: 16000 }` to add the params Deepgram needs for that.

// Opens a Deepgram live-transcription connection.
//   onTranscript({ text, speaker, isFinal })
//   onError(message) — genuine socket errors only (not a plain close)
//   onClose(wasIntentional) — wasIntentional is true iff our own close()
//     was called; false means Deepgram closed on us (idle timeout, server
//     hiccup, etc.) — see liveCall.js for how that's used to reconnect.
// Returns { send(chunk), close(), ready: Promise<void> }.
export function connectDeepgram({ onTranscript, onError, onClose, encoding, sampleRate }) {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error('DEEPGRAM_API_KEY is not set. Copy .env.example to .env and add your key.')
  }

  const params = new URLSearchParams(BASE_PARAMS)
  if (encoding) {
    params.set('encoding', encoding)
    if (sampleRate) params.set('sample_rate', String(sampleRate))
  }

  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', process.env.DEEPGRAM_API_KEY])
  let closing = false // set by our own close() — distinguishes "we hung up" from Deepgram dropping us

  const ready = new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return // keep-alive / non-JSON frame
    }

    if (msg.type !== 'Results') return
    const alt = msg.channel?.alternatives?.[0]
    if (!alt || !alt.transcript) return

    onTranscript({
      text: alt.transcript.trim(),
      speaker: alt.words?.[0]?.speaker ?? 0,
      isFinal: Boolean(msg.is_final)
    })
  })

  ws.on('error', (err) => {
    onError?.(`Deepgram connection error: ${err.message}`)
  })

  // Deepgram doesn't reliably echo back code 1000 for a close *we*
  // initiated (observed code 1005 — "no status received" — for our own
  // graceful close()s), so a raw code check can't tell intentional apart
  // from unexpected. Use the `closing` flag we set ourselves instead.
  ws.on('close', () => {
    onClose?.(closing)
  })

  return {
    ready,
    send(chunk) {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk)
    },
    close() {
      closing = true
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }))
      }
      ws.close()
    }
  }
}
