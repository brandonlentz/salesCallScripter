import { useEffect, useState } from 'react'

// Today's Dials Made / Calls Answered — see dailyMetrics.js in main.
// "Answered" means the call ran 90+ seconds (the team's own working
// definition, not a telephony-level signal this app has no access to).
// Resets naturally at midnight since it's derived from today's recording
// folders, not an in-memory session counter (see dailyMetrics.js).
export default function CallMetrics() {
  const [metrics, setMetrics] = useState(null)

  useEffect(() => {
    let cancelled = false
    window.api.metrics.getToday().then((m) => {
      if (!cancelled) setMetrics(m)
    })
    const off = window.api.metrics.onUpdate((m) => setMetrics(m))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // Nothing recorded yet and the initial fetch hasn't resolved — render
  // nothing rather than a flash of zeroes.
  if (!metrics) return null

  return (
    <div className="call-metrics" title="Today's dials and calls answered (90s+)">
      📞 {metrics.dialsMade} dial{metrics.dialsMade === 1 ? '' : 's'} · ✅ {metrics.callsAnswered} answered
    </div>
  )
}
