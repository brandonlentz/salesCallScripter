import { useState } from 'react'

function formatUsd(n) {
  return `$${n.toFixed(4)}`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

// One row of a report bucket (Suggestions / Call Analysis / Other) — see
// costReport.js's emptyBucket/addToBucket shape.
function BucketRow({ label, bucket }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{bucket.requestCount}</td>
      <td>{bucket.inputTokens.toLocaleString()}</td>
      <td>{bucket.outputTokens.toLocaleString()}</td>
      <td>{formatUsd(bucket.costUsd)}</td>
    </tr>
  )
}

// Centered popup (same pattern as CallSummaryModal) opened from the "Cost
// Report" header button — lets a rep pick a date range and see AI usage
// cost broken down by suggestions vs. call analysis vs. everything else,
// plus how many times the REISift Zap fired in that window. See
// costReport.js in main for where this data actually comes from (durable
// on-disk logs, not the live session-only UsageMeter).
export default function CostReportModal({ open, onClose }) {
  const [startDate, setStartDate] = useState(() => daysAgoIso(6))
  const [endDate, setEndDate] = useState(() => todayIso())
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)

  if (!open) return null

  async function handleGenerate() {
    if (startDate > endDate) {
      setStatus('error')
      setError('Start date must be before the end date.')
      return
    }
    setStatus('loading')
    setError('')
    try {
      const result = await window.api.costReport.generate(startDate, endDate)
      setReport(result)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err?.message || 'Failed to generate report.')
    }
  }

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__card">
        <div className="modal__header">
          <h2>Cost Report</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal__body">
          <div className="cost-report__range">
            <label className="field field--inline">
              <span>From</span>
              <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="field field--inline">
              <span>To</span>
              <input type="date" value={endDate} min={startDate} max={todayIso()} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <button type="button" onClick={handleGenerate} disabled={status === 'loading'}>
              {status === 'loading' ? 'Generating…' : 'Generate'}
            </button>
          </div>

          {status === 'error' && <p className="panel__error">{error}</p>}

          {status === 'ready' && report && (
            <div className="cost-report__results">
              <h3 className="cost-report__section-heading">Call activity</h3>
              <div className="cost-report__table-wrap">
                <table className="usage-meter__table">
                  <thead>
                    <tr>
                      <th>Dials Made</th>
                      <th>Answered (90s+)</th>
                      <th>Conversations (60s+)</th>
                      <th>Offer Made</th>
                      <th>Offer Declined</th>
                      <th>Properties Worked</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{report.dialsMade}</td>
                      <td>{report.callsAnswered}</td>
                      <td>{report.conversations}</td>
                      <td>{report.offerMade}</td>
                      <td>{report.offerDeclined}</td>
                      <td>{report.propertiesWorked}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 className="cost-report__section-heading">AI usage cost</h3>
              <div className="cost-report__table-wrap">
                <table className="usage-meter__table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Requests</th>
                      <th>In</th>
                      <th>Out</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    <BucketRow label="Suggestions" bucket={report.suggestions} />
                    <BucketRow label="Call Analysis" bucket={report.callAnalysis} />
                    <BucketRow label="Other (parsing/setup)" bucket={report.other} />
                  </tbody>
                </table>
              </div>

              <p className="cost-report__total">
                Total AI cost ({report.startDate} to {report.endDate}): <strong>{formatUsd(report.totalCostUsd)}</strong>
              </p>

              <p className="cost-report__zaps">
                🔁 Zaps fired: <strong>{report.zapsFired}</strong>
                {report.zapsFailed > 0 && (
                  <span className="panel__hint"> ({report.zapsFailed} failed)</span>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
