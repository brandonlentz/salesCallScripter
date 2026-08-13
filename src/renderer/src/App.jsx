import { useCallback, useEffect, useState } from 'react'
import { CALL_TYPES, CALL_SCRIPTS, getStages } from '../../shared/callScripts.js'
import TrainingPanel from './TrainingPanel'
import LiveCallPanel from './LiveCallPanel'
import ScriptPanel from './ScriptPanel'
import PropertyPanel from './PropertyPanel'
import ScriptVariantPanel from './ScriptVariantPanel'

const ORIGINAL_VARIANT = { id: 'original', label: 'Original' }

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

  function handleModeChange(next) {
    if (next === mode) return
    setMode(next)
    setTranscriptText('')
    setSuggestionState(initialSuggestionState)
  }

  // Click-to-call: select the property as call context and jump straight
  // to Live Call mode, since that's the obvious next screen once you've
  // dialed. Dialing itself (and picking the call type) is handled in
  // PropertyPanel/LiveCallPanel.
  function handleCall(property) {
    setSelectedProperty(property)
    handleModeChange('live')
    setPropertyOpen(false)
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
          <button type="button" onClick={() => setScriptOpen(true)}>
            Script
          </button>
          <button type="button" onClick={() => setPropertyOpen(true)}>
            {selectedProperty ? `Property: ${selectedProperty.label}` : 'Property'}
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
        <LiveCallPanel
          onTranscriptChange={setTranscriptText}
          onSuggestions={requestSuggestions}
          callType={callType}
          property={selectedProperty}
        />
      )}

      <ScriptPanel
        open={scriptOpen}
        onClose={() => setScriptOpen(false)}
        callType={callType}
        activeStage={activeStage}
        sections={activeSections}
      />

      <PropertyPanel
        open={propertyOpen}
        onClose={() => setPropertyOpen(false)}
        selected={selectedProperty}
        onSelect={(property) => {
          setSelectedProperty(property)
          setPropertyOpen(false)
        }}
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
    </div>
  )
}

export default App
