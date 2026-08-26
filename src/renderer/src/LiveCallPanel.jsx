import { useEffect, useRef, useState } from 'react'
import CallSummaryModal from './CallSummaryModal'

// Deepgram only marks a channel entry final at a genuine pause, so there's
// little upside in waiting long after that to ask for suggestions — every
// ms here comes straight out of the 1-2s target from "prospect stops
// talking" to "suggestion on screen". Kept non-zero only to let a couple of
// back-to-back final fragments settle before firing.
const AUTO_SUGGEST_DEBOUNCE_MS = 300

// Captures live-call audio and streams it to Deepgram via the main process.
// Native audio capture only (see native/audiotap): a native Core Audio
// process tap captures the call app's audio directly — no BlackHole/virtual
// device and no system Output hijack, your real speakers/headset just keep
// working normally the whole time. Your mic uses whatever the system
// default input device is at call time (no picker — nothing to configure).
// Two channels, each a dedicated single-speaker Deepgram stream ('rep' from
// your mic, 'prospect' from the native tap helper) — the channel IS the
// speaker, no diarization guessing needed.
//
// BlackHole dual-stream and single-mic acoustic-pickup modes were removed
// (see [[native-audio-tap]] / [[live-call-audio-setup]] project memory) —
// BlackHole is no longer installed on the dev machine and turned out to be
// actively harmful (interfered with real call audio), and native tap
// supersedes both once its target-process bug was fixed.
//
// Both starting and ending are manual (Start Call / End Call) — dialing a
// phone number from PropertyPanel no longer auto-starts recording/
// transcription; it only selects the property/contact as call context (see
// App.jsx's handleCall). An earlier version auto-started on dial and also
// tried auto-detecting hangup from a volume heuristic in liveCall.js, but
// the latter risked ending a call early during a real, long silence (a rep
// on hold, a long thinking pause) — worse than requiring one click each way.
export default function LiveCallPanel({ onTranscriptChange, onSuggestions, callType, property }) {
  const [status, setStatus] = useState('idle') // idle | connecting | live | error
  const [error, setError] = useState('')
  const [entries, setEntries] = useState([])
  const [interimText, setInterimText] = useState('')
  const [autoSuggest, setAutoSuggest] = useState(true)
  // Empty = let the native helper use its own default (the daemon that
  // actually renders call audio, not the visible Phone/FaceTime app itself
  // — see native/audiotap/main.swift's header comment). Only needed as an
  // override in edge cases.
  const [nativeProcessName, setNativeProcessName] = useState('')
  const [audiotapStatus, setAudiotapStatus] = useState('')
  // Post-call popup (see CallSummaryModal.jsx) — status: 'loading' | 'ready'
  // | 'error' | 'empty' (no conversation captured, e.g. a misdial).
  const [summary, setSummary] = useState({ open: false, recordingDir: null, status: 'idle', error: '', analysis: null })

  const recordersRef = useRef({}) // channel -> MediaRecorder
  const streamsRef = useRef({}) // channel -> MediaStream, call-scoped (torn down on stop())
  const debounceRef = useRef(null)
  const unsubscribeRef = useRef([])

  const transcriptText = entries
    .map((e) => `${e.speaker === 'rep' ? 'You' : 'Them'}: ${e.text}`)
    .join('\n')

  useEffect(() => {
    onTranscriptChange(transcriptText)
  }, [transcriptText, onTranscriptChange])

  const transcriptTextRef = useRef('')
  useEffect(() => {
    transcriptTextRef.current = transcriptText
  }, [transcriptText])

  // Guards stop() against a double-fire (e.g. mashing End Call) — a ref
  // rather than reading `status` directly since stop() can be called from a
  // closure captured at an earlier render than the current one.
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])

  function appendEntry(speaker, text) {
    setEntries((prev) => [...prev, { speaker, text }])
    if (autoSuggest && speaker === 'prospect') {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSuggestions(transcriptTextRef.current)
      }, AUTO_SUGGEST_DEBOUNCE_MS)
    }
  }

  function attachRecorderToStream(channel, stream) {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = async (e) => {
      if (e.data.size === 0) return
      window.api.liveCall.sendAudioChunk(channel, await e.data.arrayBuffer())
    }
    recorder.start(150)
    recordersRef.current[channel] = recorder
  }

  // Your mic ('rep' channel) — opened fresh on Start Call, torn down on End
  // Call. No deviceId constraint: whatever the system default input is at
  // that moment. The 'prospect' channel never goes through here — the main
  // process feeds those chunks in directly from the native audiotap helper.
  async function openMicStream() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamsRef.current.rep = stream
    attachRecorderToStream('rep', stream)
  }

  async function start() {
    setError('')
    setAudiotapStatus('')
    setStatus('connecting')

    try {
      await window.api.liveCall.start(['rep', 'prospect'], {
        callType,
        property,
        nativeAudioTap: { processName: nativeProcessName.trim() || undefined }
      })
    } catch (err) {
      setError(err.message)
      setStatus('error')
      return
    }

    try {
      await openMicStream()
    } catch (err) {
      Object.values(recordersRef.current).forEach((r) => r.stop())
      Object.values(streamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()))
      recordersRef.current = {}
      streamsRef.current = {}
      await window.api.liveCall.stop(transcriptTextRef.current)
      setError(`Could not open microphone: ${err.message}`)
      setStatus('error')
      return
    }

    const offTranscript = window.api.liveCall.onTranscript(({ channel, text, isFinal }) => {
      if (!text) return
      if (!isFinal) {
        setInterimText(text)
        return
      }
      setInterimText('')
      appendEntry(channel, text) // the channel IS the speaker ('rep' or 'prospect')
    })
    const offError = window.api.liveCall.onError((message) => setError(message))
    const offAudiotapStatus = window.api.liveCall.onAudiotapStatus((message) => setAudiotapStatus(message))
    unsubscribeRef.current = [offTranscript, offError, offAudiotapStatus]

    setStatus('live')
  }

  async function stop() {
    if (statusRef.current === 'idle') return // guards against a double-fire (see the ref's comment above)
    statusRef.current = 'idle'

    Object.values(recordersRef.current).forEach((r) => r.stop())
    Object.values(streamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()))
    recordersRef.current = {}
    streamsRef.current = {}
    clearTimeout(debounceRef.current)
    unsubscribeRef.current.forEach((off) => off())
    unsubscribeRef.current = []

    // Read the final transcript before clearing it — the call itself is
    // still saved to disk in full either way (see recording.js), this only
    // resets what's shown on screen for the next call.
    const finalTranscript = transcriptTextRef.current
    const { dir } = await window.api.liveCall.stop(finalTranscript)
    setStatus('idle')
    setInterimText('')
    setEntries([])

    // Post-call popup (see CallSummaryModal.jsx) — every call gets one,
    // including a misdial/no-answer (nothing to grade, but still confirms
    // the recording).
    if (!finalTranscript.trim()) {
      setSummary({ open: true, recordingDir: dir, status: 'empty', error: '', analysis: null })
      return
    }
    setSummary({ open: true, recordingDir: dir, status: 'loading', error: '', analysis: null })
    try {
      const analysis = await window.api.callAnalysis.analyze(finalTranscript, callType)
      setSummary({ open: true, recordingDir: dir, status: 'ready', error: '', analysis })
    } catch (err) {
      setSummary({ open: true, recordingDir: dir, status: 'error', error: err.message, analysis: null })
    }
  }

  function handleClear() {
    setEntries([])
  }

  useEffect(() => {
    return () => {
      Object.values(recordersRef.current).forEach((r) => r.stop())
      Object.values(streamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()))
      unsubscribeRef.current.forEach((off) => off())
    }
  }, [])

  return (
    <section className="panel panel--training">
      <h2>Live Call</h2>

      <label className="field">
        <span>Process name override (advanced, optional)</span>
        <input
          type="text"
          value={nativeProcessName}
          onChange={(e) => setNativeProcessName(e.target.value)}
          disabled={status !== 'idle'}
          placeholder="leave blank — auto-detects the call audio daemon"
        />
      </label>

      <p className="panel__hint">
        Click <strong>Start Call</strong> below once you&apos;re on the line to begin recording
        and transcribing, and <strong>End Call</strong> when you hang up. No device setup
        needed — your mic uses the system default, and your normal speakers/headset keep working
        the whole time (native audio tap, see <code>native/audiotap</code>). The first time this
        runs, macOS will ask you to approve audio capture (System Settings → Privacy &amp;
        Security → Screen &amp; System Audio Recording). If the helper isn&apos;t built yet, run{' '}
        <code>npm run build:audiotap</code> from the project root.
      </p>

      {error && <p className="panel__error">{error}</p>}
      {audiotapStatus && <p className="panel__hint">🎙 {audiotapStatus}</p>}

      <div className="call-button-row">
        {status === 'live' ? (
          <button type="button" className="call-button call-button--end" onClick={stop}>
            End Call
          </button>
        ) : (
          <button
            type="button"
            className="call-button call-button--start"
            onClick={start}
            disabled={status === 'connecting'}
          >
            {status === 'connecting' ? 'Connecting…' : 'Start Call'}
          </button>
        )}
      </div>

      <div className="training-controls">
        <button type="button" onClick={handleClear} disabled={!entries.length || status === 'live'}>
          Clear
        </button>
        <button
          type="button"
          disabled={!entries.length}
          onClick={() => onSuggestions(transcriptTextRef.current)}
        >
          Get Suggestions Now
        </button>
      </div>

      <label className="field field--inline">
        <input
          type="checkbox"
          checked={autoSuggest}
          onChange={(e) => setAutoSuggest(e.target.checked)}
        />
        <span>Auto-request suggestions after the prospect speaks (uses the Claude API each time)</span>
      </label>

      {interimText && <p className="panel__hint">…{interimText}</p>}
      <p className="panel__hint">
        Status: {status}
        {status === 'live' && ' · ● Recording'}
        {entries.length > 0 && ` · ${entries.length} lines`}
      </p>

      <CallSummaryModal
        open={summary.open}
        recordingDir={summary.recordingDir}
        status={summary.status}
        error={summary.error}
        analysis={summary.analysis}
        onClose={() => setSummary((s) => ({ ...s, open: false }))}
      />
    </section>
  )
}
