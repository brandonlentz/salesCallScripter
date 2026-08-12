import { useCallback, useEffect, useRef, useState } from 'react'

const AUTO_SUGGEST_DEBOUNCE_MS = 1200

// Captures the built-in mic (single stream — see src/main/deepgram.js for
// why), streams it to Deepgram via the main process, and turns the
// diarized results into a speaker-labeled transcript that feeds the same
// suggestion pipeline Training Mode uses.
export default function LiveCallPanel({ onTranscriptChange, onSuggestions }) {
  const [status, setStatus] = useState('idle') // idle | connecting | live | error
  const [error, setError] = useState('')
  const [entries, setEntries] = useState([])
  const [interimText, setInterimText] = useState('')
  const [autoSuggest, setAutoSuggest] = useState(true)
  const [swapped, setSwapped] = useState(false)

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const firstSpeakerRef = useRef(null)
  const swappedRef = useRef(false)
  const debounceRef = useRef(null)
  const unsubscribeRef = useRef([])

  useEffect(() => {
    swappedRef.current = swapped
  }, [swapped])

  const transcriptText = entries
    .map((e) => `${e.speaker === 'rep' ? 'You' : 'Them'}: ${e.text}`)
    .join('\n')

  useEffect(() => {
    onTranscriptChange(transcriptText)
  }, [transcriptText, onTranscriptChange])

  // Keep a ref to the latest transcript text so the debounced suggestion
  // request (set up once per `start()` call) always sees current text.
  const transcriptTextRef = useRef('')
  useEffect(() => {
    transcriptTextRef.current = transcriptText
  }, [transcriptText])

  const labelForSpeaker = useCallback((dgIndex) => {
    if (firstSpeakerRef.current === null) {
      firstSpeakerRef.current = dgIndex // whoever speaks first is assumed to be the rep
    }
    const isFirstSpeaker = dgIndex === firstSpeakerRef.current
    const isRep = swappedRef.current ? !isFirstSpeaker : isFirstSpeaker
    return isRep ? 'rep' : 'prospect'
  }, [])

  async function start() {
    setError('')
    setStatus('connecting')
    firstSpeakerRef.current = null

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access denied. Allow mic access in System Settings and try again.')
      setStatus('error')
      return
    }
    streamRef.current = stream

    try {
      await window.api.liveCall.start()
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop())
      setError(err.message)
      setStatus('error')
      return
    }

    const offTranscript = window.api.liveCall.onTranscript(({ text, speaker, isFinal }) => {
      if (!text) return
      if (!isFinal) {
        setInterimText(text)
        return
      }
      setInterimText('')
      const label = labelForSpeaker(speaker)
      setEntries((prev) => [...prev, { speaker: label, text }])

      if (autoSuggest && label === 'prospect') {
        clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          onSuggestions(transcriptTextRef.current)
        }, AUTO_SUGGEST_DEBOUNCE_MS)
      }
    })
    const offError = window.api.liveCall.onError((message) => setError(message))
    unsubscribeRef.current = [offTranscript, offError]

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = async (e) => {
      if (e.data.size === 0) return
      window.api.liveCall.sendAudioChunk(await e.data.arrayBuffer())
    }
    recorder.start(150)
    recorderRef.current = recorder

    setStatus('live')
  }

  async function stop() {
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    recorderRef.current = null
    streamRef.current = null
    clearTimeout(debounceRef.current)
    unsubscribeRef.current.forEach((off) => off())
    unsubscribeRef.current = []
    await window.api.liveCall.stop()
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
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      unsubscribeRef.current.forEach((off) => off())
    }
  }, [])

  return (
    <section className="panel panel--training">
      <h2>Live Call</h2>
      <p className="panel__hint">
        Uses the built-in mic — keep the call on speaker (not headphones/AirPods) so it picks up
        both sides. Speaker labels are a guess (first to talk = &ldquo;You&rdquo;); use Swap if
        it&apos;s backwards.
      </p>

      {error && <p className="panel__error">{error}</p>}

      <div className="training-controls">
        {status === 'live' ? (
          <button type="button" onClick={stop}>
            End Call
          </button>
        ) : (
          <button type="button" onClick={start} disabled={status === 'connecting'}>
            {status === 'connecting' ? 'Connecting…' : 'Start Call'}
          </button>
        )}
        <button type="button" onClick={handleSwap} disabled={!entries.length}>
          Swap Speakers
        </button>
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
        {entries.length > 0 && ` · ${entries.length} lines`}
      </p>
    </section>
  )
}
