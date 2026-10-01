import { useEffect, useState } from 'react'

const OFFER_OUTCOMES = [
  { value: 'offer-made', label: 'Offer Made', icon: '✅' },
  { value: 'offer-declined', label: 'Offer Declined', icon: '❌' }
]

// Centered popup shown right after a call ends (manual End Call or
// auto-detected hangup — see LiveCallPanel.jsx) — confirms the recording
// was saved and shows an AI-graded summary of the rep's performance against
// Jeremy Miner's NEPQ framework (see callAnalysis.js). Deliberately a
// centered modal, not a side drawer like the other panels — this is a
// one-time result to read and dismiss, not a workspace to keep open.
//
// Also where Offer Made / Offer Declined gets captured for an "offer" call
// — this is the first moment the rep is looking back at this specific call
// rather than already dialing the next one, same reasoning LiveCallPanel's
// Start Call prompt uses for phone-status disposition going out instead.
export default function CallSummaryModal({ open, recordingDir, callType, status, error, analysis, onClose }) {
  const [offerOutcome, setOfferOutcomeState] = useState('')

  // Resets for each new call's popup rather than carrying over the last
  // call's choice — recordingDir changes every time a call is recorded.
  useEffect(() => {
    setOfferOutcomeState('')
  }, [recordingDir])

  if (!open) return null

  async function handleSetOfferOutcome(outcome) {
    setOfferOutcomeState(outcome)
    if (recordingDir) await window.api.recordings.setOfferOutcome(recordingDir, outcome)
  }

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__card">
        <div className="modal__header">
          <h2>Call Summary</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal__body">
          {recordingDir ? (
            <p className="panel__hint">
              🎙 Recording saved.{' '}
              <button type="button" className="modal__link" onClick={() => window.api.recordings.reveal(recordingDir)}>
                Show in Finder
              </button>
            </p>
          ) : (
            <p className="panel__hint">
              No recording was saved for this call (the recording may have failed to start — check
              for an earlier error banner).
            </p>
          )}

          {callType === 'offer' && recordingDir && (
            <div className="call-summary__offer-outcome">
              <span className="start-call-overlay__disposition-label">Outcome:</span>
              <div className="phone-status-row">
                {OFFER_OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`phone-status-row__item${offerOutcome === o.value ? ' is-active' : ''}`}
                    onClick={() => handleSetOfferOutcome(o.value)}
                  >
                    {o.icon} {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {status === 'empty' && (
            <p className="panel__placeholder">No conversation was captured, so there&apos;s nothing to grade.</p>
          )}

          {status === 'loading' && <p className="panel__hint">Grading the call against NEPQ…</p>}

          {status === 'error' && <p className="panel__error">{error}</p>}

          {status === 'ready' && analysis && (
            <div className="call-summary">
              <div className="call-summary__score">
                <span className="call-summary__score-value">{analysis.score}</span>
                <span className="call-summary__score-max">/10</span>
                <span className="call-summary__score-label">NEPQ score</span>
              </div>

              <p className="call-summary__text">{analysis.summary}</p>

              {analysis.wentWell?.length > 0 && (
                <div className="call-summary__section call-summary__section--good">
                  <h3>What went well</h3>
                  <ul>
                    {analysis.wentWell.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.wentPoorly?.length > 0 && (
                <div className="call-summary__section call-summary__section--bad">
                  <h3>What went poorly</h3>
                  <ul>
                    {analysis.wentPoorly.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.improvements?.length > 0 && (
                <div className="call-summary__section call-summary__section--improve">
                  <h3>Work on next time</h3>
                  <ul>
                    {analysis.improvements.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
