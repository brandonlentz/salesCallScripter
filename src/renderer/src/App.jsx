import { useCallback, useEffect, useState } from 'react'
import { CALL_TYPES, CALL_SCRIPTS, getStages } from '../../shared/callScripts.js'
import LiveCallPanel from './LiveCallPanel'
import ScriptPanel from './ScriptPanel'
import PropertyPanel from './PropertyPanel'
import ScriptVariantPanel from './ScriptVariantPanel'
import NepqReferencePanel from './NepqReferencePanel'
import UsageMeter from './UsageMeter'

const ORIGINAL_VARIANT = { id: 'original', label: 'Original' }

const initialSuggestionState = {
  loading: false,
  error: '',
  stage: null,
  stageRationale: '',
  suggestions: []
}

// Training Mode (replaying a saved transcript against the suggestion
// engine, no live call needed — see TrainingPanel.jsx/trainingTranscripts.js)
// is disabled for now, not removed — the toggle and TrainingPanel usage
// were pulled out of the header/layout below, but the component, its IPC
// handlers, and the transcripts on disk are all still intact for whenever
// it comes back.
function App() {
  const [callType, setCallType] = useState('intro')
  const [transcriptText, setTranscriptText] = useState('')
  const [suggestionState, setSuggestionState] = useState(initialSuggestionState)
  const [selectedProperty, setSelectedProperty] = useState(null)
  const [propertyOpen, setPropertyOpen] = useState(false)

  // Script variants (lightweight split-testing) — see scriptVariants.js.
  // `variants` is the list for the current call type (seeded with the
  // builtin "Original" so the picker never renders empty while the real
  // list loads); `variantId` is which one is "live"; `variantSections` is
  // that variant's actual sections, fetched via IPC since it's no longer a
  // static import once variants can be created at runtime.
  const [variantId, setVariantId] = useState('original')
  const [variants, setVariants] = useState([ORIGINAL_VARIANT])
  const [variantSections, setVariantSections] = useState(null)
  const [variantPanelOpen, setVariantPanelOpen] = useState(false)
  const [nepqPanelOpen, setNepqPanelOpen] = useState(false)

  const refreshVariants = useCallback(() => {
    window.api.scriptVariants.list(callType).then(setVariants)
  }, [callType])

  useEffect(() => {
    refreshVariants()
  }, [refreshVariants])

  useEffect(() => {
    let cancelled = false
    window.api.scriptVariants.get(callType, variantId).then((v) => {
      if (!cancelled) setVariantSections(v.sections)
    })
    return () => {
      cancelled = true
    }
  }, [callType, variantId])

  // Falls back to the builtin script while a variant fetch is in flight (or
  // for the common 'original' case) rather than showing nothing.
  const activeSections = variantSections ?? CALL_SCRIPTS[callType]

  const requestSuggestions = useCallback(
    async (text) => {
      if (!text.trim()) return

      setSuggestionState((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const result = await window.api.suggestions.get(text, callType, selectedProperty, variantId)
        setSuggestionState({ loading: false, error: '', ...result })
      } catch (err) {
        setSuggestionState((prev) => ({ ...prev, loading: false, error: err.message }))
      }
    },
    [callType, selectedProperty, variantId]
  )

  // Changing call type mid-session invalidates whatever stage/suggestions
  // were computed under the old script, and resets to that call type's
  // Original variant since a variant id is only meaningful within the call
  // type it was created for.
  function handleCallTypeChange(next) {
    setCallType(next)
    setVariantId('original')
    setVariantSections(null)
    setSuggestionState(initialSuggestionState)
  }

  function handleVariantChange(next) {
    setVariantId(next)
    setVariantSections(null)
    setSuggestionState(initialSuggestionState)
  }

  // Click-to-call: select the property AND the specific contact/number
  // dialed (PropertyPanel already knows both, since it's the one placing
  // the call) as call context. `contact` grounds the suggestion engine in
  // exactly who's on the line — see buildPropertyContext in nepqPrompt.js —
  // rather than just the property in general, which matters once a
  // property has more than one contact or a contact has more than one
  // number. Dialing itself is handled in PropertyPanel.
  function handleCall(property, contact) {
    setSelectedProperty(contact ? { ...property, activeContact: contact } : property)
    setPropertyOpen(false)
  }

  // Manual override for when you hit Start Call mid-conversation (already
  // past Intro, say in TARP) — the AI re-detects the stage from the
  // transcript on every suggestion round anyway (see nepqPrompt.js), so
  // this is just a way to jump the script panel there immediately instead
  // of waiting for the first round to catch up. The next auto/manual
  // suggestion request can still move it again once it has transcript to
  // go on.
  function handleStageJump(stageId) {
    setSuggestionState((prev) => ({ ...prev, stage: stageId, stageRationale: 'Manually set' }))
  }

  const stages = getStages(callType, activeSections)
  const activeStage = suggestionState.stage ?? stages[0].id

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Sales Call Scripter</h1>
          <p className="app__subtitle">NEPQ live-call teleprompter</p>
        </div>
        <div className="app__header-controls">
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
          <label className="field field--inline">
            <span>Script</span>
            <select value={variantId} onChange={(e) => handleVariantChange(e.target.value)}>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setVariantPanelOpen(true)}>
            Manage Scripts
          </button>
          <button type="button" onClick={() => setNepqPanelOpen(true)}>
            NEPQ Framework
          </button>
          <button type="button" onClick={() => setPropertyOpen(true)}>
            {selectedProperty ? `Property: ${selectedProperty.label}` : 'Property'}
          </button>
          <UsageMeter />
        </div>
      </header>

      <nav className="stage-tracker" aria-label="Call stages">
        {stages.map((stage) => (
          <button
            type="button"
            key={stage.id}
            className={`stage-tracker__item${stage.id === activeStage ? ' is-active' : ''}`}
            onClick={() => handleStageJump(stage.id)}
            title={`Jump script to ${stage.label}`}
          >
            {stage.label}
          </button>
        ))}
      </nav>

      <main className="app__main">
        <ScriptPanel callType={callType} activeStage={activeStage} sections={activeSections} />

        <section className="panel panel--transcript">
          <h2>Live Transcript</h2>
          {transcriptText ? (
            <pre className="panel__transcript">{transcriptText}</pre>
          ) : (
            <p className="panel__placeholder">Nothing yet. Start a call below.</p>
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
                No suggestions yet. Start a call or click &ldquo;Get Suggestions Now&rdquo;.
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

      <LiveCallPanel
        onTranscriptChange={setTranscriptText}
        onSuggestions={requestSuggestions}
        callType={callType}
        property={selectedProperty}
      />

      <PropertyPanel
        open={propertyOpen}
        onClose={() => setPropertyOpen(false)}
        selected={selectedProperty}
        onSelect={(property) => {
          setSelectedProperty(property)
          setPropertyOpen(false)
        }}
        onUpdated={setSelectedProperty}
        onClear={() => setSelectedProperty(null)}
        onCall={handleCall}
      />

      <ScriptVariantPanel
        open={variantPanelOpen}
        onClose={() => setVariantPanelOpen(false)}
        callType={callType}
        variants={variants}
        selectedId={variantId}
        onSelect={(id) => {
          handleVariantChange(id)
          setVariantPanelOpen(false)
        }}
        onChanged={refreshVariants}
      />

      <NepqReferencePanel open={nepqPanelOpen} onClose={() => setNepqPanelOpen(false)} />
    </div>
  )
}

export default App
