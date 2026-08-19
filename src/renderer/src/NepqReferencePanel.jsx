import { useEffect, useState } from 'react'

// Reads a File as a base64 string (no "data:...;base64," prefix) — smallest
// path from a browser File object to what the main process's PDF parser
// (parseNepqReference.js) needs, without a Buffer polyfill in the renderer.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'))
    reader.readAsDataURL(file)
  })
}

// Slide-in drawer for the NEPQ framework reference library — upload PDFs
// (Jeremy Miner NEPQ training docs or similar) and have Claude distill them
// into reference notes (see parseNepqReference.js) that ground every
// suggestion request going forward (see nepqPrompt.js), across all call
// types. Same paste-and-review shape as ScriptVariantPanel.jsx, with a file
// upload standing in for the paste box. Unlike script variants, there's no
// "live" selection — every saved reference is always included.
export default function NepqReferencePanel({ open, onClose, onChanged }) {
  const [view, setView] = useState('list') // 'list' | 'form'
  const [references, setReferences] = useState([])
  const [listError, setListError] = useState('')
  const [label, setLabel] = useState('')
  const [file, setFile] = useState(null)
  const [parsedContent, setParsedContent] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function refresh() {
    window.api.nepqReferences
      .list()
      .then(setReferences)
      .catch((err) => setListError(err.message))
  }

  useEffect(() => {
    if (!open) return
    setView('list')
    setError('')
    setListError('')
    refresh()
  }, [open])

  if (!open) return null

  function startUpload() {
    setLabel('')
    setFile(null)
    setParsedContent(null)
    setError('')
    setView('form')
  }

  function handleFileChange(e) {
    const chosen = e.target.files?.[0] ?? null
    setFile(chosen)
    setParsedContent(null)
    if (chosen && !label.trim()) {
      // Suggest a name from the filename so most uploads don't need typing
      // one — still editable before saving.
      setLabel(chosen.name.replace(/\.pdf$/i, ''))
    }
  }

  async function handleParse() {
    if (!file) return
    setParsing(true)
    setError('')
    try {
      const base64 = await fileToBase64(file)
      const result = await window.api.nepqReferences.parse(base64, file.name)
      setParsedContent(result.content)
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  async function handleSave() {
    if (!label.trim()) {
      setError('Give this reference a name (e.g. "NEPQ Black Book").')
      return
    }
    if (!parsedContent) {
      setError('Parse the PDF first.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await window.api.nepqReferences.save({ label, filename: file?.name ?? null, content: parsedContent })
      onChanged?.()
      refresh()
      setView('list')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await window.api.nepqReferences.delete(id)
    onChanged?.()
    refresh()
  }

  return (
    <div className="drawer">
      <div className="drawer__backdrop" onClick={onClose} />
      <div className="drawer__panel">
        <div className="drawer__header">
          <h2>{view === 'list' ? 'NEPQ Framework Library' : 'Upload Reference PDF'}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer__body">
          {view === 'list' ? (
            <>
              <p className="panel__hint">
                Upload NEPQ framework material (Jeremy Miner training PDFs or similar) — Claude
                distills each into reference notes that inform every suggestion, across all call
                types. This is supplementary to the word-for-word scripts (Manage Scripts), which
                stay ground truth for exact wording.
              </p>

              {listError && <p className="panel__error">{listError}</p>}

              {references.length === 0 && !listError ? (
                <p className="panel__hint">No reference material uploaded yet.</p>
              ) : (
                <ul className="variant-list">
                  {references.map((r) => (
                    <li key={r.id} className="variant-list__item">
                      <span className="variant-list__main">
                        <strong>{r.label}</strong>
                        <span>
                          {r.filename ? `${r.filename} — ` : ''}
                          {new Date(r.uploadedAt).toLocaleDateString()}
                        </span>
                      </span>
                      <button type="button" onClick={() => handleDelete(r.id)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <button type="button" onClick={startUpload}>
                + Upload PDF
              </button>
            </>
          ) : (
            <div className="variant-form">
              {error && <p className="panel__error">{error}</p>}

              <label className="field">
                <span>PDF file</span>
                <input type="file" accept="application/pdf" onChange={handleFileChange} />
              </label>

              <button type="button" onClick={handleParse} disabled={parsing || !file}>
                {parsing ? 'Reading & distilling…' : 'Parse PDF'}
              </button>

              {parsedContent && (
                <>
                  <label className="field">
                    <span>Reference name *</span>
                    <input
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g. NEPQ Black Book"
                      autoFocus
                    />
                  </label>

                  <div className="variant-preview">
                    <span className="variant-preview__label">
                      Extracted {parsedContent.length.toLocaleString()} characters — review before
                      saving:
                    </span>
                    <div className="variant-preview__section">
                      <span>
                        {parsedContent.slice(0, 600)}
                        {parsedContent.length > 600 ? '…' : ''}
                      </span>
                    </div>
                  </div>
                </>
              )}

              <div className="property-form__actions">
                <button type="button" onClick={() => setView('list')}>
                  Cancel
                </button>
                <button type="button" onClick={handleSave} disabled={saving || !parsedContent}>
                  {saving ? 'Saving…' : 'Save Reference'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
