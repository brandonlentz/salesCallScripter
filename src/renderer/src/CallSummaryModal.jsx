// Centered popup shown right after a call ends (manual End Call or
// auto-detected hangup — see LiveCallPanel.jsx) — confirms the recording
// was saved and shows an AI-graded summary of the rep's performance against
// Jeremy Miner's NEPQ framework (see callAnalysis.js). Deliberately a
// centered modal, not a side drawer like the other panels — this is a
// one-time result to read and dismiss, not a workspace to keep open.
export default function CallSummaryModal({ open, recordingDir, status, error, analysis, onClose }) {
  if (!open) return null

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
