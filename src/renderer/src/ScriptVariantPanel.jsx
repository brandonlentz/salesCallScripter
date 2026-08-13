import { useEffect, useState } from 'react'

// Slide-in drawer for managing script variants (lightweight split-testing)
// for the current call type — see src/main/scriptVariants.js. List existing
// variants and pick which is "live" (also doable from the header select in
// App.jsx — this is the fuller view), or paste in a new script draft and
// have it parsed into sections (same paste-and-parse pattern as
// PropertyPanel.jsx / parseProperty.js, applied to script text instead of
// CRM records — see parseScriptVariant.js).
export default function ScriptVariantPanel({
  open,
  onClose,
  callType,
  variants,
  selectedId,
  onSelect,
  onChanged
}) {
  const [view, setView] = useState('list') // 'list' | 'form'
  const [label, setLabel] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [parsedSections, setParsedSections] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setView('list')
    setError('')
  }, [open])

  if (!open) return null

  function startCreate() {
    setLabel('')
    setPasteText('')
    setParsedSections(null)
    setError('')
    setView('form')
  }

  async function handleParse() {
    setParsing(true)
    setError('')
    try {
      const result = await window.api.scriptVariants.parse(pasteText)
      setParsedSections(result.sections)
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  async function handleSave() {
    if (!label.trim()) {
      setError('Give this variant a name (e.g. "Softer opening").')
      return
    }
    if (!parsedSections) {
      setError('Parse the pasted script text first.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await window.api.scriptVariants.save(callType, {
        label,
        sections: parsedSections
      })
      onChanged()
      onSelect(saved.id)
      setView('list')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await window.api.scriptVariants.delete(callType, id)
    onChanged()
  }

  return (
    <div className="drawer">
      <div className="drawer__backdrop" onClick={onClose} />
      <div className="drawer__panel">
        <div className="drawer__header">
          <h2>{view === 'list' ? 'Script Variants' : 'New Variant'}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer__body">
          {view === 'list' ? (
            <>
              <p className="panel__hint">
                Keep a few versions of the {callType} script and pick which one&apos;s live for a
                call — judge results yourself, nothing here is tracked automatically.
              </p>
              <ul className="variant-list">
                {variants.map((v) => (
                  <li
                    key={v.id}
                    className={`variant-list__item${v.id === selectedId ? ' is-selected' : ''}`}
                  >
                    <button type="button" className="variant-list__main" onClick={() => onSelect(v.id)}>
                      <strong>{v.label}</strong>
                      {v.builtin && <span>Original — always available</span>}
                    </button>
                    {!v.builtin && (
                      <button type="button" onClick={() => handleDelete(v.id)}>
                        Delete
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={startCreate}>
                + New Variant
              </button>
            </>
          ) : (
            <div className="variant-form">
              {error && <p className="panel__error">{error}</p>}

              <label className="field">
                <span>Variant name *</span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Softer opening"
                  autoFocus
                />
              </label>

              <label className="field">
                <span>Script text</span>
                <textarea
                  rows={8}
                  value={pasteText}
                  onChange={(e) => {
                    setPasteText(e.target.value)
                    setParsedSections(null)
                  }}
                  placeholder="Paste or write out the script — stage headings help but aren't required, e.g.:&#10;&#10;Opening&#10;&quot;Hi, is this [NAME]?&quot;&#10;...&#10;&#10;Objections&#10;NOT INTERESTED: ..."
                />
              </label>
              <button type="button" onClick={handleParse} disabled={parsing || !pasteText.trim()}>
                {parsing ? 'Parsing…' : 'Parse Script'}
              </button>

              {parsedSections && (
                <div className="variant-preview">
                  <span className="variant-preview__label">
                    Parsed {parsedSections.length} section{parsedSections.length === 1 ? '' : 's'} —
                    review before saving:
                  </span>
                  {parsedSections.map((s, i) => (
                    <div className="variant-preview__section" key={i}>
                      <strong>{s.title}</strong>
                      <span>
                        {s.lines.length} line{s.lines.length === 1 ? '' : 's'}
                        {s.lines[0] ? ` — "${s.lines[0].slice(0, 60)}${s.lines[0].length > 60 ? '…' : ''}"` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="property-form__actions">
                <button type="button" onClick={() => setView('list')}>
                  Cancel
                </button>
                <button type="button" onClick={handleSave} disabled={saving || !parsedSections}>
                  {saving ? 'Saving…' : 'Save Variant'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
