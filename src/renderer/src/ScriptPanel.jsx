import { useEffect, useRef } from 'react'

// Always-visible panel showing the word-for-word script for the current
// call type, auto-scrolled to whichever stage the suggestion engine thinks
// the call is in. Used to be a slide-in drawer you had to open/close
// manually — now rendered inline in the main layout so the script stays in
// view for the whole call, no toggling needed. `sections` is passed in by
// App.jsx (the currently-selected script variant's sections — see
// scriptVariants.js) instead of being read directly from the hardcoded
// CALL_SCRIPTS, since a variant may differ from the builtin script.
export default function ScriptPanel({ callType, activeStage, sections }) {
  const sectionRefs = useRef({})
  const scrollContainerRef = useRef(null)

  useEffect(() => {
    if (!activeStage) return
    const el = sectionRefs.current[activeStage]
    const container = scrollContainerRef.current
    if (!el || !container) return
    const offsetTop = el.offsetTop - container.offsetTop - 16
    container.scrollTo({ top: offsetTop, behavior: 'smooth' })
  }, [activeStage])

  return (
    <section className="panel panel--script">
      <h2>{callType[0].toUpperCase() + callType.slice(1)} Call Script</h2>
      <div className="panel__script-body" ref={scrollContainerRef}>
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
    </section>
  )
}
