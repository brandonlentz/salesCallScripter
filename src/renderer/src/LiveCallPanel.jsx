import { useCallback, useEffect, useRef, useState } from 'react'

// Deepgram only marks a channel entry final at a genuine pause, so there's
// little upside in waiting long after that to ask for suggestions — every
// ms here comes straight out of the 1-2s target from "prospect stops
// talking" to "suggestion on screen". Kept non-zero only to let a couple of
// back-to-back final fragments settle before firing.
const AUTO_SUGGEST_DEBOUNCE_MS = 300
const NO_DEVICE = ''

// Captures live-call audio and streams it to Deepgram via the main process.
// Two modes, chosen by which devices are selected below:
//
//   - Dual-stream (recommended once BlackHole is set up): the real mic
//     captures your voice, a BlackHole loopback device captures the Phone
//     app's call audio directly. Each is its own Deepgram connection, so
//     speaker labels are exact — no guessing.
//   - Single-mic (fallback, works today with no extra setup): one mic
//     stream picks up both voices acoustically (call on speaker), and
//     Deepgram's diarization guesses which parts are you vs. the prospect.
export default function LiveCallPanel({ onTranscriptChange, onSuggestions, callType, property }) {
  const [status, setStatus] = useState('idle') // idle | connecting | live | error
  const [error, setError] = useState('')
  const [entries, setEntries] = useState([])
  const [interimText, setInterimText] = useState('')
  const [autoSuggest, setAutoSuggest] = useState(true)
  const [swapped, setSwapped] = useState(false)
  const [devices, setDevices] = useState([])
  const [micDeviceId, setMicDeviceId] = useState(NO_DEVICE)
  const [callerDeviceId, setCallerDeviceId] = useState(NO_DEVICE)
  const [outputDevices, setOutputDevices] = useState([])
  const [monitorDeviceId, setMonitorDeviceId] = useState(NO_DEVICE)

  const recordersRef = useRef({}) // channel -> MediaRecorder
  const streamsRef = useRef({}) // channel -> MediaStream
  const firstSpeakerRef = useRef(null) // single-mic mode only
  const swappedRef = useRef(false)
  const debounceRef = useRef(null)
  const unsubscribeRef = useRef([])
  const monitorAudioRef = useRef(null) // plays caller audio back out to a real speaker/headset

  const dualStreamMode = callerDeviceId !== NO_DEVICE && callerDeviceId !== micDeviceId

  useEffect(() => {
    swappedRef.current = swapped
  }, [swapped])

  // Device labels are blank until mic permission has been granted once, so
  // request it up front just to unlock enumerateDevices().
  useEffect(() => {
    async function loadDevices() {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((t) => t.stop())
      } catch {
        // Permission denied — device list will just show blank labels below.
      }
      const all = await navigator.mediaDevices.enumerateDevices()
      const list = all.filter((d) => d.kind === 'audioinput')
      setDevices(list)

      const blackhole = list.find((d) => /blackhole/i.test(d.label))
      const builtIn = list.find((d) => /macbook|built-in/i.test(d.label))
      setMicDeviceId(builtIn?.deviceId ?? list[0]?.deviceId ?? NO_DEVICE)
      if (blackhole) setCallerDeviceId(blackhole.deviceId)

      // Monitor output: where we play the captured caller audio back out so
      // you can actually hear them (system output should be set to
      // BlackHole alone during calls, which has no speaker of its own).
      const outputs = all.filter((d) => d.kind === 'audiooutput')
      setOutputDevices(outputs)
      const headset = outputs.find((d) => !/blackhole|macbook|built-in/i.test(d.label))
      setMonitorDeviceId(headset?.deviceId ?? outputs[0]?.deviceId ?? NO_DEVICE)
    }
    loadDevices()
  }, [])

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

  // Single-mic mode only: whoever talks first in the mixed stream is
  // assumed to be the rep.
  const labelForDiarizedSpeaker = useCallback((dgIndex) => {
    if (firstSpeakerRef.current === null) {
      firstSpeakerRef.current = dgIndex
    }
    const isFirstSpeaker = dgIndex === firstSpeakerRef.current
    const isRep = swappedRef.current ? !isFirstSpeaker : isFirstSpeaker
    return isRep ? 'rep' : 'prospect'
  }, [])

  function appendEntry(speaker, text) {
    setEntries((prev) => [...prev, { speaker, text }])
    if (autoSuggest && speaker === 'prospect') {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSuggestions(transcriptTextRef.current)
      }, AUTO_SUGGEST_DEBOUNCE_MS)
    }
  }

  async function openStream(channel, deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } }
    })
    streamsRef.current[channel] = stream

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

  // Dual-stream mode: BlackHole (or whatever's selected as Caller audio) has
  // no speaker of its own, so play the same stream we're capturing back out
  // to a real output device — that's how you actually hear the caller.
  async function startMonitor(stream) {
    if (!stream || !monitorAudioRef.current) return
    const audio = monitorAudioRef.current
    audio.srcObject = stream
    if (monitorDeviceId && typeof audio.setSinkId === 'function') {
      try {
        await audio.setSinkId(monitorDeviceId)
      } catch (err) {
        console.warn('Could not set monitor output device:', err)
      }
    }
    await audio.play()
  }

  function stopMonitor() {
    const audio = monitorAudioRef.current
    if (!audio) return
    audio.pause()
    audio.srcObject = null
  }

  async function start() {
    setError('')
    setStatus('connecting')
    firstSpeakerRef.current = null

    const channels = dualStreamMode ? ['rep', 'prospect'] : ['mixed']

    try {
      await window.api.liveCall.start(channels, { callType, property })
    } catch (err) {
      setError(err.message)
      setStatus('error')
      return
    }

    try {
      if (dualStreamMode) {
        await openStream('rep', micDeviceId)
        await openStream('prospect', callerDeviceId)
        await startMonitor(streamsRef.current.prospect)
      } else {
        await openStream('mixed', micDeviceId)
      }
    } catch (err) {
      Object.values(recordersRef.current).forEach((r) => r.stop())
      Object.values(streamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()))
      recordersRef.current = {}
      streamsRef.current = {}
      stopMonitor()
      await window.api.liveCall.stop(transcriptTextRef.current)
      setError(`Could not open audio device: ${err.message}`)
      setStatus('error')
      return
    }

    const offTranscript = window.api.liveCall.onTranscript(({ channel, text, speaker, isFinal }) => {
      if (!text) return
      if (!isFinal) {
        setInterimText(text)
        return
      }
      setInterimText('')

      const label =
        channel === 'rep' || channel === 'prospect'
          ? channel // dual-stream: the channel already IS the speaker
          : labelForDiarizedSpeaker(speaker) // single-mic: guess from diarization

      appendEntry(label, text)
    })
    const offError = window.api.liveCall.onError((message) => setError(message))
    unsubscribeRef.current = [offTranscript, offError]

    setStatus('live')
  }

  async function stop() {
    Object.values(recordersRef.current).forEach((r) => r.stop())
    Object.values(streamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()))
    recordersRef.current = {}
    streamsRef.current = {}
    stopMonitor()
    clearTimeout(debounceRef.current)
    unsubscribeRef.current.forEach((off) => off())
    unsubscribeRef.current = []
    await window.api.liveCall.stop(transcriptTextRef.current)
    setStatus('idle')
    setInterimText('')
  }

  function handleSwap() {
    setSwapped((s) => !s)
    setEntries((prev) =>
      prev.map((e) => ({ ...e, speaker: e.speaker === 'rep' ? 'prospect' : 'rep' }))
    )
  }

  function handleClear() {
    setEntries([])
    firstSpeakerRef.current = null
  }

  useEffect(() => {
    return () => {
      Object.values(recordersRef.current).forEach((r) => r.stop())
      Object.values(streamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()))
      stopMonitor()
      unsubscribeRef.current.forEach((off) => off())
    }
  }, [])

  const blackholeAvailable = devices.some((d) => /blackhole/i.test(d.label))

  return (
    <section className="panel panel--training">
      <h2>Live Call</h2>

      <label className="field">
        <span>Your mic</span>
        <select
          value={micDeviceId}
          onChange={(e) => setMicDeviceId(e.target.value)}
          disabled={status !== 'idle'}
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Caller audio (optional)</span>
        <select
          value={callerDeviceId}
          onChange={(e) => setCallerDeviceId(e.target.value)}
          disabled={status !== 'idle'}
        >
          <option value={NO_DEVICE}>None — pick up caller via mic instead (single-mic mode)</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
      </label>

      {dualStreamMode && (
        <label className="field">
          <span>Monitor output (hear the caller)</span>
          <select
            value={monitorDeviceId}
            onChange={(e) => setMonitorDeviceId(e.target.value)}
            disabled={status !== 'idle'}
          >
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live monitor relay, not user media */}
      <audio ref={monitorAudioRef} hidden />

      <p className="panel__hint">
        {dualStreamMode ? (
          <>
            Dual-stream mode: your mic and the caller audio device are captured separately, so
            speaker labels are exact. Your Mac&apos;s <strong>system output</strong> should be set
            to Caller audio&apos;s device alone (e.g. BlackHole 2ch) during calls — the app plays
            that stream back out to Monitor output above so you can hear them. Don&apos;t use a
            Multi-Output Device for this; some call apps (including the Phone app) silently ignore
            aggregate output devices.
          </>
        ) : blackholeAvailable ? (
          <>
            BlackHole is available but not selected as Caller audio — pick it above for exact
            speaker separation instead of the diarization guess.
          </>
        ) : (
          <>
            BlackHole not detected (install it, set it as your system output alone during calls —
            not via a Multi-Output Device, then reboot). Falling back to single-mic mode: keep the
            call on speaker, not headphones, so the mic picks up both sides. Speaker labels are a
            guess (first to talk = &ldquo;You&rdquo;) — use Swap if it&apos;s backwards.
          </>
        )}
      </p>

      {error && <p className="panel__error">{error}</p>}

      <div className="training-controls">
        {status === 'live' ? (
          <button type="button" onClick={stop}>
            End Call
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={status === 'connecting' || !micDeviceId}
          >
            {status === 'connecting' ? 'Connecting…' : 'Start Call'}
          </button>
        )}
        {!dualStreamMode && (
          <button type="button" onClick={handleSwap} disabled={!entries.length}>
            Swap Speakers
          </button>
        )}
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
    </section>
  )
}
