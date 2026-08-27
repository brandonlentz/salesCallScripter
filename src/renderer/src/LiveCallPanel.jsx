import { useEffect, useRef, useState } from 'react'
import CallSummaryModal from './CallSummaryModal'
import { PHONE_STATUSES } from './phoneStatuses.js'
import { VOICEMAIL_SCRIPTS, fillVoicemailScript } from '../../shared/voicemailScripts.js'

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
// phone number from PropertyPanel doesn't auto-start recording/
// transcription, it only selects the property/contact as call context (see
// App.jsx's handleCall) and bumps `dialSignal`, which pops a full-screen
// prompt here so the manual Start Call click is impossible to miss right
// after you dial, without actually starting anything for you. An earlier
// version auto-started on dial outright, and also tried auto-detecting
// hangup from a volume heuristic in liveCall.js — the latter risked ending
// a call early during a real, long silence (a rep on hold, a long thinking
// pause), worse than requiring one click each way.
export default function LiveCallPanel({
  onTranscriptChange,
  onSuggestions,
  callType,
  property,
  dialSignal,
  onPhoneStatus
}) {
  const [status, setStatus] = useState('idle') // idle | connecting | live | error
  const [error, setError] = useState('')
  const [entries, setEntries] = useState([])
  const [interimText, setInterimText] = useState('')
  const [autoSuggest, setAutoSuggest] = useState(true)
  const [audiotapStatus, setAudiotapStatus] = useState('')
  // Full-screen "hit Start Call" prompt — see the dialSignal effect below.
  // Dialing still doesn't auto-start recording (see this file's header
  // comment on why that was deliberately reverted), but the entry point to
  // start it manually needs to be impossible to miss, not buried in a
  // panel that may be scrolled out of view.
  const [showStartPrompt, setShowStartPrompt] = useState(false)
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

  // App.jsx bumps `dialSignal` every time a phone/FaceTime number is
  // dialed from anywhere in the app (Quick Call, a saved property's
  // contact, the property list's quick-dial button — see App.jsx's
  // handleCall). This only opens the full-screen prompt below, not an
  // auto-start — skips the very first render (dialSignalRef starts equal
  // to the initial prop) so mounting the panel doesn't itself pop it, and
  // does nothing if a call's already underway.
  const dialSignalRef = useRef(dialSignal)
  useEffect(() => {
    if (dialSignal === undefined || dialSignal === dialSignalRef.current) return
    dialSignalRef.current = dialSignal
    if (statusRef.current === 'idle') setShowStartPrompt(true)
    // Only dialSignal should retrigger this — status is read via the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialSignal])

  // Once the call actually connects, the full-screen prompt has done its
  // job — the regular in-panel status/stage-tracker/script take over.
  useEffect(() => {
    if (status === 'live') setShowStartPrompt(false)
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
        // No UI for a process-name override anymore (it was an "advanced,
        // optional" edge case that never came up) — always let the native
        // helper auto-detect the call audio daemon, see audioTap.js.
        nativeAudioTap: {}
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

  // Who the full-screen prompt (and its "Calling ..." line) should credit
  // — the specific contact dialed if there is one, else just the property
  // label, else nothing (a Quick Call with no name given, or no property
  // context at all).
  const callingWho = property?.activeContact?.name || property?.label || ''

  // Disposition control (see phoneStatuses.js) only makes sense for a
  // saved property — there's an id to persist the status against, and a
  // specific dialed number to tag. A Quick Call's synthetic property has
  // neither, so no control renders for it (same guard PropertyPanel uses).
  const canDispositionCall = Boolean(property?.id && property?.dialedNumber)
  const dialedPhoneStatus = canDispositionCall
    ? (property.contacts ?? [])
        .flatMap((c) => c.phones ?? [])
        .find((p) => p.number === property.dialedNumber)?.status ?? ''
    : ''

  return (
    <>
      {showStartPrompt && (
        <div className="start-call-overlay" role="dialog" aria-label="Start call">
          <button
            type="button"
            className="start-call-overlay__close"
            onClick={() => setShowStartPrompt(false)}
            aria-label="Dismiss"
          >
            ✕
          </button>
          <div className="start-call-overlay__content">
            {callingWho && <p className="start-call-overlay__who">Calling {callingWho}</p>}
            {error && <p className="panel__error">{error}</p>}
            <button
              type="button"
              className="call-button call-button--start start-call-overlay__button"
              onClick={start}
              disabled={status === 'connecting'}
            >
              {status === 'connecting' ? 'Connecting…' : 'Start Call'}
            </button>

            {property?.dialedNumber && (
              <div className="start-call-overlay__secondary-actions">
                <button
                  type="button"
                  onClick={() => window.api.dialer.facetime(property.dialedNumber)}
                >
                  🎥 FaceTime
                </button>
                <button type="button" onClick={() => window.api.dialer.text(property.dialedNumber)}>
                  💬 Text
                </button>
              </div>
            )}

            {canDispositionCall && (
              <div className="start-call-overlay__disposition">
                <span className="start-call-overlay__disposition-label">
                  This number ({property.dialedNumber}):
                </span>
                <div className="phone-status-row">
                  {PHONE_STATUSES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={`phone-status-row__item${dialedPhoneStatus === s.value ? ' is-active' : ''}`}
                      onClick={() => onPhoneStatus?.(s.value)}
                    >
                      {s.icon ? `${s.icon} ${s.label}` : s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              className="start-call-overlay__dismiss"
              onClick={() => setShowStartPrompt(false)}
            >
              Not now
            </button>

            <div className="start-call-overlay__scripts">
              {VOICEMAIL_SCRIPTS.map((script) => (
                <div key={script.id} className="voicemail-script">
                  <p className="voicemail-script__label">{script.label}</p>
                  <pre className="voicemail-script__text">
                    {fillVoicemailScript(script.template, {
                      contactName: property?.activeContact?.name,
                      deceasedName: property?.deceasedName
                    })}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <section className="panel panel--training">
        <h2>Live Call</h2>

        <p className="panel__hint">
          Click <strong>Start Call</strong> below once you&apos;re on the line to begin recording
          and transcribing, and <strong>End Call</strong> when you hang up. No device setup
          needed — your mic uses the system default, and your normal speakers/headset keep
          working the whole time (native audio tap, see <code>native/audiotap</code>). The first
          time this runs, macOS will ask you to approve audio capture (System Settings → Privacy
          &amp; Security → Screen &amp; System Audio Recording). If the helper isn&apos;t built
          yet, run <code>npm run build:audiotap</code> from the project root.
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
    </>
  )
}
