import { useEffect, useRef } from 'react'
import { CALL_SCRIPTS } from '../../shared/callScripts.js'

// Slide-in drawer showing the word-for-word script for the current call
// type, auto-scrolled to whichever stage the suggestion engine thinks the
// call is in. Ported from call-tracker's ScriptDrawer.tsx.
export default function ScriptPanel({ open, onClose, callType, activeStage }) {
  const script = CALL_SCRIPTS[callType]
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
          {script.map((section) => {
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
