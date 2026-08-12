import WebSocket from 'ws'

// Streaming speech-to-text for live calls, via Deepgram. Runs in the main
// process so DEEPGRAM_API_KEY never touches the renderer.
//
// Audio capture strategy: a single microphone stream, not separate mic +
// system-audio streams. Calls go out through the macOS Phone app; with the
// call audio playing through the Mac's speakers (not headphones/AirPods),
// the built-in mic naturally picks up both sides of the conversation, and
// Deepgram's diarization (`diarize: true`) splits it back into two speakers.
// This mirrors the approach validated in the call-tracker project — no
// BlackHole or virtual audio device required.
const DEEPGRAM_PARAMS = new URLSearchParams({
  model: 'nova-2',
  language: 'en-US',
  diarize: 'true',
  punctuate: 'true',
  smart_format: 'true',
  interim_results: 'true',
  utterance_end_ms: '1000',
  vad_events: 'true'
})
// No `encoding`/`container` param: the renderer sends MediaRecorder's
// audio/webm;codecs=opus blobs as-is, and Deepgram auto-detects the
// container from the stream (same as the validated call-tracker setup).

// Opens a Deepgram live-transcription connection.
//   onTranscript({ text, speaker, isFinal })
//   onError(message)
//   onClose()
// Returns { send(chunk), close(), ready: Promise<void> }.
export function connectDeepgram({ onTranscript, onError, onClose }) {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error('DEEPGRAM_API_KEY is not set. Copy .env.example to .env and add your key.')
  }

  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS}`, ['token', process.env.DEEPGRAM_API_KEY])

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

  ws.on('close', (code) => {
    if (code !== 1000) {
      onError?.(`Deepgram disconnected unexpectedly (code ${code}).`)
    }
    onClose?.()
  })

  return {
    ready,
    send(chunk) {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk)
    },
    close() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }))
      }
      ws.close()
    }
  }
}
