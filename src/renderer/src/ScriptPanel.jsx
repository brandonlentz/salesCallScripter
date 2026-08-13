import { useEffect, useRef } from 'react'

// Slide-in drawer showing the word-for-word script for the current call
// type, auto-scrolled to whichever stage the suggestion engine thinks the
// call is in. Originally ported from call-tracker's ScriptDrawer.tsx;
// `sections` is now passed in by App.jsx (the currently-selected script
// variant's sections — see scriptVariants.js) instead of being read
// directly from the hardcoded CALL_SCRIPTS, since a variant may differ
// from the builtin script.
export default function ScriptPanel({ open, onClose, callType, activeStage, sections }) {
  const sectionRefs = useRef({})
  const scrollContainerRef = useRef(null)

  useEffect(() => {
    if (!open || !activeStage) return
    const el = sectionRefs.current[activeStage]
    const container = scrollContainerRef.current
    if (!el || !container) return
    const offsetTop = el.offsetTop - container.offsetTop - 16
    container.scrollTo({ top: offsetTop, behavior: 'smooth' })
  }, [activeStage, open])

  if (!open) return null

  return (
    <div className="drawer">
      <div className="drawer__backdrop" onClick={onClose} />
      <div className="drawer__panel">
        <div className="drawer__header">
          <h2>{callType[0].toUpperCase() + callType.slice(1)} Call Script</h2>
          <button type="button" onClick={onClose} aria-label="Close script">
            ✕
          </button>
        </div>
        <div className="drawer__body" ref={scrollContainerRef}>
          {sections.map((section) => {
            const isActive = section.stage === activeStage
            return (
              <div
                key={section.stage}
                ref={(el) => {
                  sectionRefs.current[section.stage] = el
                }}
                className={`script-section${isActive ? ' is-active' : ''}`}
              >
                <p className="script-section__title">
                  {section.title}
                  {isActive && <span className="script-section__flag">← you are here</span>}
                </p>
                <ul>
                  {section.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
