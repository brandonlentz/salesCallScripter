import { useCallback, useState } from 'react'
import { CALL_TYPES, getStages } from '../../shared/callScripts.js'
import TrainingPanel from './TrainingPanel'
import LiveCallPanel from './LiveCallPanel'
import ScriptPanel from './ScriptPanel'

const initialSuggestionState = {
  loading: false,
  error: '',
  stage: null,
  stageRationale: '',
  suggestions: []
}

function App() {
  const [mode, setMode] = useState('training') // 'training' | 'live'
  const [callType, setCallType] = useState('intro')
  const [transcriptText, setTranscriptText] = useState('')
  const [suggestionState, setSuggestionState] = useState(initialSuggestionState)
  const [scriptOpen, setScriptOpen] = useState(false)

  const requestSuggestions = useCallback(
    async (text) => {
      if (!text.trim()) return

      setSuggestionState((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const result = await window.api.suggestions.get(text, callType)
        setSuggestionState({ loading: false, error: '', ...result })
      } catch (err) {
        setSuggestionState((prev) => ({ ...prev, loading: false, error: err.message }))
      }
    },
    [callType]
  )

  // Changing call type mid-session invalidates whatever stage/suggestions
  // were computed under the old script.
  function handleCallTypeChange(next) {
    setCallType(next)
    setSuggestionState(initialSuggestionState)
  }

  function handleModeChange(next) {
    if (next === mode) return
    setMode(next)
    setTranscriptText('')
    setSuggestionState(initialSuggestionState)
  }

  const stages = getStages(callType)
  const activeStage = suggestionState.stage ?? stages[0].id

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Sales Call Scripter</h1>
          <p className="app__subtitle">NEPQ live-call teleprompter</p>
        </div>
        <div className="app__header-controls">
          <div className="mode-toggle">
            <button
              type="button"
              className={mode === 'training' ? 'is-active' : ''}
              onClick={() => handleModeChange('training')}
            >
              Training
            </button>
            <button
              type="button"
              className={mode === 'live' ? 'is-active' : ''}
              onClick={() => handleModeChange('live')}
            >
              Live Call
            </button>
          </div>
          <label className="field field--inline">
            <span>Call type</span>
            <select value={callType} onChange={(e) => handleCallTypeChange(e.target.value)}>
              {CALL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type[0].toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setScriptOpen(true)}>
            Script
          </button>
        </div>
      </header>

      <nav className="stage-tracker" aria-label="Call stages">
        {stages.map((stage) => (
          <span
            key={stage.id}
            className={`stage-tracker__item${stage.id === activeStage ? ' is-active' : ''}`}
          >
            {stage.label}
          </span>
        ))}
      </nav>

      <main className="app__main">
        <section className="panel panel--transcript">
          <h2>Live Transcript</h2>
          {transcriptText ? (
            <pre className="panel__transcript">{transcriptText}</pre>
          ) : (
            <p className="panel__placeholder">
              Nothing yet. {mode === 'training' ? 'Load a transcript' : 'Start a call'} below.
            </p>
          )}
        </section>

        <section className="panel panel--suggestions">
          <h2>Suggested Next Lines</h2>
          {suggestionState.loading && <p className="panel__hint">Thinking…</p>}
          {suggestionState.error && <p className="panel__error">{suggestionState.error}</p>}
          {!suggestionState.loading &&
            !suggestionState.error &&
            suggestionState.suggestions.length === 0 && (
              <p className="panel__placeholder">
                No suggestions yet. {mode === 'training' ? 'Play a transcript' : 'Start a call'} or
                click &ldquo;Get Suggestions Now&rdquo;.
              </p>
            )}
          {suggestionState.stageRationale && (
            <p className="panel__hint">{suggestionState.stageRationale}</p>
          )}
          <ul className="suggestions-list">
            {suggestionState.suggestions.map((s, i) => (
              <li key={i} className={`suggestions-list__item suggestions-list__item--${s.type}`}>
                {s.text}
              </li>
            ))}
          </ul>
        </section>
      </main>

      {mode === 'training' ? (
        <TrainingPanel
          callType={callType}
          onCallTypeChange={handleCallTypeChange}
          onTranscriptChange={setTranscriptText}
          onSuggestions={requestSuggestions}
        />
      ) : (
        <LiveCallPanel onTranscriptChange={setTranscriptText} onSuggestions={requestSuggestions} />
      )}

      <ScriptPanel
        open={scriptOpen}
        onClose={() => setScriptOpen(false)}
        callType={callType}
        activeStage={activeStage}
      />
    </div>
  )
}

export default App
