import { useCallback, useState } from 'react'
import { NEPQ_STAGES } from './nepqStages'
import TrainingPanel from './TrainingPanel'

const initialSuggestionState = {
  loading: false,
  error: '',
  stage: null,
  stageRationale: '',
  suggestions: []
}

function App() {
  const [transcriptText, setTranscriptText] = useState('')
  const [suggestionState, setSuggestionState] = useState(initialSuggestionState)

  const requestSuggestions = useCallback(async (text) => {
    if (!text.trim()) return

    setSuggestionState((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const result = await window.api.suggestions.get(text)
      setSuggestionState({ loading: false, error: '', ...result })
    } catch (err) {
      setSuggestionState((prev) => ({ ...prev, loading: false, error: err.message }))
    }
  }, [])

  const activeStage = suggestionState.stage ?? NEPQ_STAGES[0].id

  return (
    <div className="app">
      <header className="app__header">
        <h1>Sales Call Scripter</h1>
        <p className="app__subtitle">NEPQ live-call teleprompter</p>
      </header>

      <nav className="stage-tracker" aria-label="NEPQ stages">
        {NEPQ_STAGES.map((stage) => (
          <span
            key={stage.id}
            className={`stage-tracker__item${stage.id === activeStage ? ' is-active' : ''}`}
            title={stage.description}
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
              Nothing yet. Load a transcript in Training Mode below, or, once wired up, start a
              live call.
            </p>
          )}
        </section>

        <section className="panel panel--suggestions">
          <h2>Suggested NEPQ Prompts</h2>
          {suggestionState.loading && <p className="panel__hint">Thinking…</p>}
          {suggestionState.error && <p className="panel__error">{suggestionState.error}</p>}
          {!suggestionState.loading &&
            !suggestionState.error &&
            suggestionState.suggestions.length === 0 && (
              <p className="panel__placeholder">
                No suggestions yet. Play a transcript in Training Mode or click &ldquo;Get
                Suggestions Now&rdquo;.
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

      <TrainingPanel onTranscriptChange={setTranscriptText} onSuggestions={requestSuggestions} />
    </div>
  )
}

export default App
