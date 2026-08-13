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
  const [monitorError, setMonitorError] = useState('')
  const [testingMonitor, setTestingMonitor] = useState(false)

  const recordersRef = useRef({}) // channel -> MediaRecorder
  const streamsRef = useRef({}) // channel -> MediaStream, call-scoped (torn down on stop())
  const callerStreamRef = useRef(null) // BlackHole capture, NOT call-scoped — see the effect below
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

  // Keep the caller/BlackHole audio flowing to your headset the whole time
  // you're on the Live Call screen — not just between Start Call/End Call.
  // BlackHole has no speaker of its own, so without this you'd hear nothing
  // the instant a call connects (or after one ends) unless a call happened
  // to be "live" at that exact moment. This stream is intentionally NOT
  // torn down by stop() — only when the device selection changes or the
  // component unmounts (leaving Live Call mode). start() reuses this same
  // stream for transcription capture rather than opening a second one.
  useEffect(() => {
    if (!dualStreamMode) return
    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: { exact: callerDeviceId } } })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        callerStreamRef.current = stream
        await startMonitor(stream)
      })
      .catch((err) => {
        if (!cancelled) {
          setMonitorError(`Could not open caller audio device for continuous monitoring: ${err.message}`)
        }
      })

    return () => {
      cancelled = true
      stopMonitor()
      callerStreamRef.current?.getTracks().forEach((t) => t.stop())
      callerStreamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startMonitor/stopMonitor close over monitorDeviceId intentionally, re-running this effect on every render of those functions would reopen the stream unnecessarily
  }, [dualStreamMode, callerDeviceId, monitorDeviceId])

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

  // For channels whose stream is call-scoped (your mic; the mixed stream in
  // single-mic mode) — opened fresh on Start Call, torn down on End Call.
  // The prospect/caller channel in dual-stream mode does NOT use this — it
  // reuses the persistent stream from the effect above instead, see start().
  async function openStream(channel, deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } }
    })
    streamsRef.current[channel] = stream
    attachRecorderToStream(channel, stream)
  }

  // Dual-stream mode: BlackHole (or whatever's selected as Caller audio) has
  // no speaker of its own, so play the same stream we're capturing back out
  // to a real output device — that's how you actually hear the caller.
  // Any failure here is surfaced in the UI, not just console.warn'd — a
  // silent failure means you're on a live call unable to hear the prospect
  // with no indication why.
  async function startMonitor(stream) {
    if (!stream || !monitorAudioRef.current) return
    const audio = monitorAudioRef.current
    setMonitorError('')
    audio.srcObject = stream
    if (typeof audio.setSinkId !== 'function') {
      setMonitorError(
        'This app build cannot route audio to a specific output device (setSinkId unsupported). ' +
          "You won't hear the caller unless your system output is something other than BlackHole."
      )
    } else if (monitorDeviceId) {
      try {
        await audio.setSinkId(monitorDeviceId)
      } catch (err) {
        setMonitorError(
          `Could not route caller audio to the selected Monitor output (${err.message}). ` +
            'Pick a different device below before starting the next call.'
        )
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

  // Plays a short test tone through the selected Monitor output — lets you
  // confirm you can actually hear on that device *before* a call starts,
  // instead of finding out mid-call. Uses a synthesized tone (Web Audio
  // oscillator routed into a MediaStreamDestination) rather than a static
  // audio file, so there's nothing to bundle.
  async function testMonitorAudio() {
    const audio = monitorAudioRef.current
    if (!audio) return
    setMonitorError('')
    setTestingMonitor(true)
    let ctx
    try {
      ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      const osc = ctx.createOscillator()
      osc.frequency.value = 440
      osc.connect(dest)
      audio.srcObject = dest.stream
      if (typeof audio.setSinkId !== 'function') {
        throw new Error('setSinkId unsupported in this app build')
      }
      if (monitorDeviceId) {
        await audio.setSinkId(monitorDeviceId)
      }
      await audio.play()
      osc.start()
      await new Promise((resolve) => setTimeout(resolve, 700))
      osc.stop()
    } catch (err) {
      setMonitorError(`Test tone failed on that output device: ${err.message}`)
    } finally {
      audio.pause()
      audio.srcObject = null
      ctx?.close()
      setTestingMonitor(false)
    }
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
        // Reuse the persistent caller stream (already flowing to your
        // headset via the effect above) rather than opening a second
        // capture on the same device — just attach a recorder to it.
        if (!callerStreamRef.current) {
          throw new Error('Caller audio device is not ready yet — wait a second and try again.')
        }
        attachRecorderToStream('prospect', callerStreamRef.current)
      } else {
        await openStream('mixed', micDeviceId)
      }
    } catch (err) {
      Object.values(recordersRef.current).forEach((r) => r.stop())
      Object.values(streamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()))
      recordersRef.current = {}
      streamsRef.current = {}
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
    // Stops recorders (including 'prospect', which just detaches from the
    // persistent caller stream — the recording, not the stream itself) and
    // any call-scoped streams (your mic). The caller/monitor stream keeps
    // running so you keep hearing them between calls — see the effect above.
    Object.values(recordersRef.current).forEach((r) => r.stop())
    Object.values(streamsRef.current).forEach((s) => s.getTracks().forEach((t) => t.stop()))
    recordersRef.current = {}
    streamsRef.current = {}
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
          <div className="field field--inline">
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
            <button type="button" onClick={testMonitorAudio} disabled={testingMonitor}>
              {testingMonitor ? 'Playing…' : '🔊 Test'}
            </button>
          </div>
        </label>
      )}

      {monitorError && <p className="panel__error">{monitorError}</p>}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live monitor relay, not user media */}
      <audio ref={monitorAudioRef} hidden />

      <p className="panel__hint">
        {dualStreamMode ? (
          <>
            Dual-stream mode: your mic and the caller audio device are captured separately, so
            speaker labels are exact. Your Mac&apos;s <strong>system output</strong> should be set
            to Caller audio&apos;s device alone (e.g. BlackHole 2ch) at all times on this screen —
            the app relays that audio out to Monitor output continuously (not just during a call),
            so you&apos;ll hear them as soon as the call connects, no Start Call needed first.
            Don&apos;t use a Multi-Output Device for this; some call apps (including the Phone app)
            silently ignore aggregate output devices.
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
