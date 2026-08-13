import { useEffect, useState } from 'react'

const BLANK_DRAFT = {
  label: '',
  contactName: '',
  contactPhone: '',
  contactRelationship: '',
  deceasedName: '',
  propertyAddress: '',
  taxStatus: '',
  caseNumber: '',
  knownHeirs: '',
  priorContactNotes: '',
  offerAmount: '',
  painPointsSummary: ''
}

// Slide-in drawer for picking which property/lead the current call is
// about, so the suggestion engine can ground its coaching in this specific
// deceased owner, tax situation, known heirs, etc. — not just the generic
// script.
//
// Entries are stored locally (see src/main/properties.js) and, for now,
// entered manually (copy from REISift) rather than pulled live — REISift
// doesn't expose a documented search/pull API. Search box + list here is
// the same shape a future REISift sync would populate, so wiring that in
// later shouldn't need UI changes.
export default function PropertyPanel({ open, onClose, selected, onSelect, onClear, onCall }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [view, setView] = useState('list') // 'list' | 'form'
  const [draft, setDraft] = useState(BLANK_DRAFT)
  const [error, setError] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')

  async function refresh(q) {
    setResults(await window.api.properties.search(q))
  }

  useEffect(() => {
    if (!open) return
    setView('list')
    setError('')
    refresh(query)
    // Only re-run on open — the query effect below handles typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    refresh(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  if (!open) return null

  function startCreate() {
    setDraft(BLANK_DRAFT)
    setError('')
    setPasteText('')
    setParseError('')
    setView('form')
  }

  function startEdit(property) {
    setDraft(property)
    setError('')
    setPasteText('')
    setParseError('')
    setView('form')
  }

  async function handleParse() {
    setParsing(true)
    setParseError('')
    try {
      const parsed = await window.api.properties.parse(pasteText)
      // Merge onto the current draft rather than replacing it outright —
      // preserves the id when editing, and any field left blank in the
      // pasted text (parser returns "" for those) still overwrites, which
      // is the point: re-pasting fresher text should win.
      setDraft((prev) => ({ ...prev, ...parsed }))
    } catch (err) {
      setParseError(err.message)
    } finally {
      setParsing(false)
    }
  }

  // Dials via the OS (macOS's tel: handler — the Phone app) and hands the
  // property off to App.jsx to select as call context + switch to Live
  // Call mode. We already know who this number belongs to because we're
  // the one placing the call, from this property's own record — no
  // caller-ID lookup needed.
  function handleCall(property) {
    onCall(property)
    window.api.dialer.call(property.contactPhone)
  }

  async function handleDelete(id) {
    await window.api.properties.delete(id)
    if (selected?.id === id) onClear()
    refresh(query)
  }

  async function handleSave() {
    setError('')
    try {
      const saved = draft.id
        ? await window.api.properties.update(draft.id, draft)
        : await window.api.properties.save(draft)
      onSelect(saved)
    } catch (err) {
      setError(err.message)
    }
  }

  function updateField(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="drawer">
      <div className="drawer__backdrop" onClick={onClose} />
      <div className="drawer__panel">
        <div className="drawer__header">
          <h2>{view === 'list' ? 'Property Context' : draft.id ? 'Edit Property' : 'New Property'}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer__body">
          {view === 'list' ? (
            <>
              {selected && (
                <div className="property-selected">
                  <div className="property-selected__label">
                    <strong>{selected.label}</strong>
                    {selected.propertyAddress && <span>{selected.propertyAddress}</span>}
                  </div>
                  {selected.contactPhone && (
                    <button type="button" onClick={() => handleCall(selected)}>
                      📞 Call
                    </button>
                  )}
                  <button type="button" onClick={onClear}>
                    Clear
                  </button>
                </div>
              )}

              <input
                type="text"
                className="property-search"
                placeholder="Search by name, address, or phone…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

              <button type="button" onClick={startCreate}>
                + New Property
              </button>

              {results.length === 0 ? (
                <p className="panel__placeholder">
                  {query ? 'No matches.' : 'No properties saved yet — click "New Property" to add one.'}
                </p>
              ) : (
                <ul className="property-list">
                  {results.map((p) => (
                    <li
                      key={p.id}
                      className={`property-list__item${selected?.id === p.id ? ' is-selected' : ''}`}
                    >
                      <button type="button" className="property-list__main" onClick={() => onSelect(p)}>
                        <strong>{p.label}</strong>
                        {(p.propertyAddress || p.contactName) && (
                          <span>{[p.contactName, p.propertyAddress].filter(Boolean).join(' — ')}</span>
                        )}
                      </button>
                      {p.contactPhone && (
                        <button type="button" onClick={() => handleCall(p)} title={`Call ${p.contactPhone}`}>
                          📞 Call
                        </button>
                      )}
                      <button type="button" onClick={() => startEdit(p)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDelete(p.id)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="property-form">
              {error && <p className="panel__error">{error}</p>}

              <div className="property-paste">
                <label className="field">
                  <span>Paste from REISift (optional — fills in the fields below)</span>
                  <textarea
                    rows={4}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Copy the property/contact page from REISift — visible text (select all) or full page HTML (DevTools → Copy outerHTML) both work — and paste it here…"
                  />
                </label>
                {parseError && <p className="panel__error">{parseError}</p>}
                <button type="button" onClick={handleParse} disabled={parsing || !pasteText.trim()}>
                  {parsing ? 'Parsing…' : 'Parse & Fill Fields'}
                </button>
              </div>

              <label className="field">
                <span>Label *</span>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => updateField('label', e.target.value)}
                  placeholder="e.g. Torres Estate"
                  autoFocus
                />
              </label>

              <div className="property-form__row">
                <label className="field">
                  <span>Contact name</span>
                  <input
                    type="text"
                    value={draft.contactName}
                    onChange={(e) => updateField('contactName', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Relationship</span>
                  <input
                    type="text"
                    value={draft.contactRelationship}
                    onChange={(e) => updateField('contactRelationship', e.target.value)}
                    placeholder="e.g. daughter, neighbor"
                  />
                </label>
              </div>

              <label className="field">
                <span>Contact phone</span>
                <input
                  type="text"
                  value={draft.contactPhone}
                  onChange={(e) => updateField('contactPhone', e.target.value)}
                />
              </label>

              <label className="field">
                <span>Deceased owner</span>
                <input
                  type="text"
                  value={draft.deceasedName}
                  onChange={(e) => updateField('deceasedName', e.target.value)}
                />
              </label>

              <label className="field">
                <span>Property address</span>
                <input
                  type="text"
                  value={draft.propertyAddress}
                  onChange={(e) => updateField('propertyAddress', e.target.value)}
                />
              </label>

              <div className="property-form__row">
                <label className="field">
                  <span>Tax/legal status</span>
                  <input
                    type="text"
                    value={draft.taxStatus}
                    onChange={(e) => updateField('taxStatus', e.target.value)}
                    placeholder="e.g. active foreclosure filed 2025"
                  />
                </label>
                <label className="field">
                  <span>Case/file number</span>
                  <input
                    type="text"
                    value={draft.caseNumber}
                    onChange={(e) => updateField('caseNumber', e.target.value)}
                  />
                </label>
              </div>

              <label className="field">
                <span>Known heirs</span>
                <input
                  type="text"
                  value={draft.knownHeirs}
                  onChange={(e) => updateField('knownHeirs', e.target.value)}
                  placeholder="comma-separated names"
                />
              </label>

              <label className="field">
                <span>Prior contact notes (from REISift)</span>
                <textarea
                  rows={3}
                  value={draft.priorContactNotes}
                  onChange={(e) => updateField('priorContactNotes', e.target.value)}
                />
              </label>

              <label className="field">
                <span>Offer amount</span>
                <input
                  type="text"
                  value={draft.offerAmount}
                  onChange={(e) => updateField('offerAmount', e.target.value)}
                />
              </label>

              <label className="field">
                <span>Prior pain points</span>
                <textarea
                  rows={2}
                  value={draft.painPointsSummary}
                  onChange={(e) => updateField('painPointsSummary', e.target.value)}
                  placeholder="e.g. from the intro call"
                />
              </label>

              <div className="property-form__actions">
                <button type="button" onClick={() => setView('list')}>
                  Cancel
                </button>
                <button type="button" onClick={handleSave}>
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
