import { useEffect, useRef, useState } from 'react'

const DEFAULT_SPEED_MS = 1800
const AUTO_SUGGEST_DEBOUNCE_MS = 2500

// Replays a saved call transcript line-by-line to simulate a live call, so
// the NEPQ suggestion engine can be tested without making a real call or
// wiring up live audio. Same engine, same IPC calls the live-call pipeline
// will use later — only the source of the transcript text differs.
export default function TrainingPanel({ callType, onCallTypeChange, onTranscriptChange, onSuggestions }) {
  const [transcripts, setTranscripts] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [lines, setLines] = useState([])
  const [visibleCount, setVisibleCount] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speedMs, setSpeedMs] = useState(DEFAULT_SPEED_MS)
  const [autoSuggest, setAutoSuggest] = useState(false)
  const [loadError, setLoadError] = useState('')

  const debounceRef = useRef(null)

  useEffect(() => {
    window.api.training
      .listTranscripts()
      .then(setTranscripts)
      .catch((err) => setLoadError(err.message))
  }, [])

  const visibleText = lines.slice(0, visibleCount).join('\n')

  // Report the growing transcript up to the parent whenever it changes, and
  // (if enabled) debounce a suggestions request off the back of it.
  useEffect(() => {
    onTranscriptChange(visibleText)

    if (!autoSuggest || visibleCount === 0) return undefined

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSuggestions(visibleText)
    }, AUTO_SUGGEST_DEBOUNCE_MS)

    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleText])

  // Auto-advance playback.
  useEffect(() => {
    if (!isPlaying) return undefined
    if (visibleCount >= lines.length) {
      setIsPlaying(false)
      return undefined
    }

    const timer = setTimeout(() => {
      setVisibleCount((count) => count + 1)
    }, speedMs)

    return () => clearTimeout(timer)
  }, [isPlaying, visibleCount, lines, speedMs])

  async function handleSelect(id) {
    setSelectedId(id)
    setIsPlaying(false)
    setVisibleCount(0)
    setLines([])
    setLoadError('')

    if (!id) return

    // Transcript categories (intro/offer) map directly onto call types, so
    // keep the suggestion engine's script in sync with whichever transcript
    // is loaded.
    const transcript = transcripts.find((t) => t.id === id)
    if (transcript && transcript.category !== callType) {
      onCallTypeChange(transcript.category)
    }

    try {
      const text = await window.api.training.loadTranscript(id)
      setLines(text.split('\n').filter((line) => line.trim().length > 0))
    } catch (err) {
      setLoadError(err.message)
    }
  }

  function handleReset() {
    setIsPlaying(false)
    setVisibleCount(0)
  }

  const atEnd = lines.length > 0 && visibleCount >= lines.length

  return (
    <section className="panel panel--training">
      <h2>Training Mode</h2>
      <p className="panel__hint">
        Replay a saved call transcript to test stage detection and suggestions without a live
        call.
      </p>

      {loadError && <p className="panel__error">{loadError}</p>}

      <label className="field">
        <span>Transcript</span>
        <select value={selectedId} onChange={(e) => handleSelect(e.target.value)}>
          <option value="">Select a transcript…</option>
          {transcripts.map((t) => (
            <option key={t.id} value={t.id}>
              [{t.category}] {t.label}
            </option>
          ))}
        </select>
      </label>

      {transcripts.length === 0 && !loadError && (
        <p className="panel__hint">
          No transcripts found in <code>transcripts/intro/</code> or{' '}
          <code>transcripts/offer/</code>.
        </p>
      )}

      <div className="training-controls">
        <button type="button" disabled={!lines.length || atEnd} onClick={() => setIsPlaying((p) => !p)}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          disabled={!lines.length || atEnd}
          onClick={() => setVisibleCount((c) => Math.min(c + 1, lines.length))}
        >
          Step
        </button>
        <button type="button" disabled={!lines.length} onClick={handleReset}>
          Reset
        </button>
        <button
          type="button"
          disabled={!visibleCount}
          onClick={() => onSuggestions(visibleText)}
        >
          Get Suggestions Now
        </button>
      </div>

      <label className="field field--inline">
        <span>Line speed</span>
        <input
          type="range"
          min="500"
          max="4000"
          step="100"
          value={speedMs}
          onChange={(e) => setSpeedMs(Number(e.target.value))}
        />
        <span>{(speedMs / 1000).toFixed(1)}s/line</span>
      </label>

      <label className="field field--inline">
        <input
          type="checkbox"
          checked={autoSuggest}
          onChange={(e) => setAutoSuggest(e.target.checked)}
        />
        <span>Auto-request suggestions as the call plays (uses the Claude API each time)</span>
      </label>

      {lines.length > 0 && (
        <p className="panel__hint">
          Line {visibleCount} of {lines.length}
        </p>
      )}
    </section>
  )
}
