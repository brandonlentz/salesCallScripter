import { useEffect, useState } from 'react'

function formatUsd(n) {
  return `$${n.toFixed(4)}`
}

function formatTokens(n) {
  return n.toLocaleString()
}

// Live running total of Claude API token spend across every feature that
// calls the API — see usageTracker.js in main. The suggestion engine fires
// repeatedly during a live call (every time the prospect finishes a
// sentence), so this is a real-time gauge while you're on a call, not just
// a post-call report. Session-only — resets when the app restarts.
export default function UsageMeter() {
  const [totals, setTotals] = useState(null)
  const [events, setEvents] = useState([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.usage.get().then(({ totals, events }) => {
      if (cancelled) return
      setTotals(totals)
      setEvents(events)
    })
    const off = window.api.usage.onUpdate(({ event, totals }) => {
      setTotals(totals)
      setEvents((prev) => [event, ...prev].slice(0, 50))
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // Nothing recorded yet and the initial fetch hasn't resolved — render
  // nothing rather than a flash of zeroes.
  if (!totals) return null

  return (
    <div className="usage-meter">
      <button
        type="button"
        className="usage-meter__summary"
        onClick={() => setExpanded((e) => !e)}
        title="Claude API usage this session"
      >
        💳 {formatUsd(totals.costUsd)} · {formatTokens(totals.inputTokens + totals.outputTokens)} tok
        {totals.requestCount > 0 && ` · ${totals.requestCount} req`}
      </button>

      {expanded && (
        <div className="usage-meter__details">
          <div className="usage-meter__totals">
            <span>Input: {formatTokens(totals.inputTokens)}</span>
            <span>Output: {formatTokens(totals.outputTokens)}</span>
            <span>
              Cache R/W: {formatTokens(totals.cacheReadInputTokens)}/
              {formatTokens(totals.cacheCreationInputTokens)}
            </span>
          </div>
          {events.length === 0 ? (
            <p className="panel__placeholder">No API calls yet this session.</p>
          ) : (
            <div className="usage-meter__table-wrap">
              <table className="usage-meter__table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>Model</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.at).toLocaleTimeString()}</td>
                      <td>{e.source}</td>
                      <td>{e.model.replace('claude-', '')}</td>
                      <td>{formatTokens(e.inputTokens)}</td>
                      <td>{formatTokens(e.outputTokens)}</td>
                      <td>{formatUsd(e.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
