import { useEffect, useState } from 'react'

const BLANK_DRAFT = {
  label: '',
  contacts: [],
  deceasedName: '',
  propertyAddress: '',
  taxStatus: '',
  caseNumber: '',
  knownHeirs: '',
  priorContactNotes: '',
  offerAmount: '',
  painPointsSummary: ''
}

const BLANK_CONTACT = { name: '', relationship: '', phones: [] }
const BLANK_PHONE = { number: '', label: '', status: '' }

// Call-outcome tag for a single number — set after a dial attempt so the
// next rep to work this property (or you, next round) knows what happened
// last time without re-reading notes. Purely informational, doesn't affect
// dialing or the suggestion engine.
const PHONE_STATUSES = [
  { value: '', label: 'No status', icon: '' },
  { value: 'correct', label: 'Correct', icon: '✅' },
  { value: 'wrong', label: 'Wrong number', icon: '❌' },
  { value: 'no-answer', label: 'No answer', icon: '📵' },
  { value: 'dnc', label: 'DNC', icon: '🚫' },
  { value: 'dead', label: 'Dead', icon: '💀' }
]

// Flattens every phone across every contact into one list, each entry
// paired with which contact it belongs to — used anywhere we need "just
// give me all the callable numbers for this property" (the compact list
// row's quick-call, mainly) without caring about the grouping.
function allPhones(property) {
  return (property.contacts ?? []).flatMap((c) =>
    (c.phones ?? []).map((p) => ({ contact: c, phone: p }))
  )
}

// Slide-in drawer for picking which property/lead the current call is
// about, so the suggestion engine can ground its coaching in this specific
// deceased owner, tax situation, known heirs, etc. — not just the generic
// script.
//
// Entries are stored locally (see src/main/properties.js), populated either
// by hand/paste-and-parse here, or live by REISift's outbound webhook (see
// reisiftWebhook.js) — both write the same shape, so this UI doesn't care
// which one created a given record.
export default function PropertyPanel({ open, onClose, selected, onSelect, onUpdated, onClear, onCall }) {
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

  // Live REISift sync (see reisiftWebhook.js) — refreshes the list if the
  // drawer's open, and refreshes App.jsx's selected property in place if
  // it's the one that just synced (e.g. a webhook lands mid-call).
  useEffect(() => {
    return window.api.properties.onSynced((property) => {
      if (open) refresh(query)
      if (selected?.id === property.id) onUpdated?.(property)
    })
    // Re-subscribes on every dependency change so the handler always closes
    // over the current open/query/selected rather than stale values from
    // whenever the listener was first attached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, selected, onUpdated])

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
  // property AND the specific contact off to App.jsx to select as call
  // context. We already know who this number belongs to — both which
  // contact and which of their numbers — because we're the one placing
  // the call, from this property's own record. No caller-ID lookup needed.
  // That contact then grounds the suggestion engine in their actual name,
  // not just the property in general (see buildPropertyContext in
  // nepqPrompt.js) — important since one property can have several
  // contacts, each with several numbers.
  function handleCall(property, contact, phoneNumber) {
    onCall(property, contact)
    window.api.dialer.call(phoneNumber)
  }

  // FaceTime is still a "call" for coaching purposes — same treatment as a
  // Phone call (see App.jsx's handleCall): selects the property/contact as
  // call context, but recording/transcription still needs a manual Start
  // Call in LiveCallPanel. The native tap likely captures FaceTime audio
  // too (same underlying daemon as Phone/Continuity calls — see
  // native/audiotap/main.swift), but that's only confirmed for Phone calls
  // so far; worth trying it on a real FaceTime call.
  function handleFaceTime(property, contact, phoneNumber) {
    onCall(property, contact)
    window.api.dialer.facetime(phoneNumber)
  }

  // Texting isn't a call — no live-call session to start, just hands off to
  // Messages.app with the conversation open so you type/send it yourself.
  function handleText(phoneNumber) {
    window.api.dialer.text(phoneNumber)
  }

  // Tags a number's call outcome from the "selected property" quick view
  // (see below) — separate from the edit form's updatePhone, which only
  // touches local draft state, because this fires while the drawer is
  // sitting on the already-saved `selected` property, mid-dialing, and
  // needs to persist immediately and refresh what App.jsx holds without
  // closing the drawer (onSelect does that, which would be disruptive here).
  async function handlePhoneStatus(contactIndex, phoneIndex, status) {
    const updated = {
      ...selected,
      contacts: selected.contacts.map((c, ci) =>
        ci === contactIndex
          ? { ...c, phones: c.phones.map((p, pi) => (pi === phoneIndex ? { ...p, status } : p)) }
          : c
      )
    }
    const saved = await window.api.properties.update(selected.id, updated)
    onUpdated(saved)
    refresh(query)
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

  function addContact() {
    setDraft((prev) => ({ ...prev, contacts: [...(prev.contacts ?? []), { ...BLANK_CONTACT }] }))
  }

  function removeContact(index) {
    setDraft((prev) => ({ ...prev, contacts: prev.contacts.filter((_, i) => i !== index) }))
  }

  function updateContact(index, field, value) {
    setDraft((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    }))
  }

  function addPhone(contactIndex) {
    setDraft((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c, i) =>
        i === contactIndex ? { ...c, phones: [...(c.phones ?? []), { ...BLANK_PHONE }] } : c
      )
    }))
  }

  function removePhone(contactIndex, phoneIndex) {
    setDraft((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c, i) =>
        i === contactIndex ? { ...c, phones: c.phones.filter((_, pi) => pi !== phoneIndex) } : c
      )
    }))
  }

  function updatePhone(contactIndex, phoneIndex, field, value) {
    setDraft((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c, i) =>
        i === contactIndex
          ? {
              ...c,
              phones: c.phones.map((p, pi) => (pi === phoneIndex ? { ...p, [field]: value } : p))
            }
          : c
      )
    }))
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
                  <div className="property-selected__header">
                    <div className="property-selected__label">
                      <strong>{selected.label}</strong>
                      {selected.propertyAddress && <span>{selected.propertyAddress}</span>}
                      {selected.reisiftUuid && (
                        <span className="panel__hint" title="Synced live from REISift">
                          🔄 {selected.reisiftStatus || 'REISift'}
                          {selected.reisiftTags?.length ? ` · ${selected.reisiftTags.join(', ')}` : ''}
                        </span>
                      )}
                    </div>
                    <button type="button" onClick={onClear}>
                      Clear
                    </button>
                  </div>
                  {(selected.contacts ?? []).length > 0 && (
                    <ul className="property-selected__contacts">
                      {selected.contacts.map((c, i) => (
                        <li key={i}>
                          <span className="property-selected__contact-name">
                            {c.name}
                            {c.relationship && <em> — {c.relationship}</em>}
                          </span>
                          <span className="property-selected__contact-phones">
                            {(c.phones ?? []).length === 0 ? (
                              <span className="panel__hint">no number</span>
                            ) : (
                              c.phones.map((p, pi) => {
                                const label = p.label ? `${p.number} (${p.label})` : p.number
                                return (
                                  <span className="phone-actions" key={pi}>
                                    <button type="button" onClick={() => handleCall(selected, c, p.number)} title={`Call ${label}`}>
                                      📞 {p.number}
                                      {p.label && <em> {p.label}</em>}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleFaceTime(selected, c, p.number)}
                                      title={`FaceTime ${label}`}
                                      aria-label={`FaceTime ${label}`}
                                    >
                                      🎥
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleText(p.number)}
                                      title={`Text ${label}`}
                                      aria-label={`Text ${label}`}
                                    >
                                      💬
                                    </button>
                                    <select
                                      className="phone-status"
                                      value={p.status ?? ''}
                                      onChange={(e) => handlePhoneStatus(i, pi, e.target.value)}
                                      title="Call outcome"
                                      aria-label={`Call outcome for ${label}`}
                                    >
                                      {PHONE_STATUSES.map((s) => (
                                        <option key={s.value} value={s.value}>
                                          {s.icon ? `${s.icon} ${s.label}` : s.label}
                                        </option>
                                      ))}
                                    </select>
                                  </span>
                                )
                              })
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
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
                  {results.map((p) => {
                    const phones = allPhones(p)
                    const first = phones[0]
                    const primaryContactName = p.contacts?.[0]?.name
                    return (
                      <li
                        key={p.id}
                        className={`property-list__item${selected?.id === p.id ? ' is-selected' : ''}`}
                      >
                        <button type="button" className="property-list__main" onClick={() => onSelect(p)}>
                          <strong>{p.label}</strong>
                          {(p.propertyAddress || primaryContactName) && (
                            <span>
                              {[primaryContactName, p.propertyAddress].filter(Boolean).join(' — ')}
                            </span>
                          )}
                        </button>
                        {first && (
                          <button
                            type="button"
                            onClick={() => handleCall(p, first.contact, first.phone.number)}
                            title={`Call ${first.contact.name || 'contact'}: ${first.phone.number}`}
                          >
                            📞{phones.length > 1 ? ` (${phones.length})` : ''}
                          </button>
                        )}
                        <button type="button" onClick={() => startEdit(p)}>
                          Edit
                        </button>
                        <button type="button" onClick={() => handleDelete(p.id)}>
                          Delete
                        </button>
                      </li>
                    )
                  })}
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

              <div className="property-contacts">
                <span className="property-contacts__label">Contacts</span>
                {(draft.contacts ?? []).length === 0 && (
                  <p className="panel__placeholder">No contacts added yet.</p>
                )}
                {(draft.contacts ?? []).map((contact, ci) => (
                  <div className="property-contact" key={ci}>
                    <div className="property-form__row">
                      <label className="field">
                        <span>Name</span>
                        <input
                          type="text"
                          value={contact.name}
                          onChange={(e) => updateContact(ci, 'name', e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Relationship</span>
                        <input
                          type="text"
                          value={contact.relationship}
                          onChange={(e) => updateContact(ci, 'relationship', e.target.value)}
                          placeholder="e.g. daughter, neighbor"
                        />
                      </label>
                    </div>

                    {(contact.phones ?? []).map((phone, pi) => (
                      <div className="property-phone-row" key={pi}>
                        <input
                          type="text"
                          value={phone.number}
                          onChange={(e) => updatePhone(ci, pi, 'number', e.target.value)}
                          placeholder="Phone number"
                        />
                        <input
                          type="text"
                          value={phone.label}
                          onChange={(e) => updatePhone(ci, pi, 'label', e.target.value)}
                          placeholder="Label (optional)"
                        />
                        <select
                          className="phone-status"
                          value={phone.status ?? ''}
                          onChange={(e) => updatePhone(ci, pi, 'status', e.target.value)}
                          aria-label={`Call outcome for ${phone.number || 'this number'}`}
                        >
                          {PHONE_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.icon ? `${s.icon} ${s.label}` : s.label}
                            </option>
                          ))}
                        </select>
                        <button type="button" onClick={() => removePhone(ci, pi)}>
                          ✕
                        </button>
                      </div>
                    ))}
                    <div className="property-contact__actions">
                      <button type="button" onClick={() => addPhone(ci)}>
                        + Add number
                      </button>
                      <button type="button" onClick={() => removeContact(ci)}>
                        Remove contact
                      </button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addContact}>
                  + Add contact
                </button>
              </div>

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
