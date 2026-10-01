import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// A call counts as "answered" once it ran long enough that someone was
// almost certainly actually on the line, not just a few seconds of ringing
// before voicemail/hangup — 90s is the team's own working definition.
const ANSWERED_THRESHOLD_MS = 90 * 1000

// A "conversation" is the team's looser bar for "we actually talked" —
// anything 60s+, whether or not it ever became a real NEPQ conversation.
// Distinct from ANSWERED_THRESHOLD_MS so both can be reported side by side.
const CONVERSATION_THRESHOLD_MS = 60 * 1000

function isInRange(isoString, startMs, endMs) {
  const t = new Date(isoString).getTime()
  return t >= startMs && t <= endMs
}

function todayRangeMs() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return { startMs: start.getTime(), endMs: start.getTime() + 24 * 60 * 60 * 1000 - 1 }
}

// Every Start Call/dial writes a recordings/<callType>/<call>/meta.json
// folder (see recording.js) — this walks all of them once and hands back
// the parsed meta for each, callers filter/aggregate from there. Reading
// fresh from disk every time (not an in-memory session counter) means these
// numbers stay correct across app restarts mid-shift and for date ranges
// well before the app's current run.
async function readAllCallMeta(dataRoot) {
  const root = join(dataRoot, 'recordings')
  const metas = []

  let callTypeDirs
  try {
    callTypeDirs = await fs.readdir(root, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return metas
    throw err
  }

  for (const callTypeDir of callTypeDirs) {
    if (!callTypeDir.isDirectory()) continue
    const callTypePath = join(root, callTypeDir.name)
    const callDirs = await fs.readdir(callTypePath, { withFileTypes: true }).catch(() => [])

    for (const callDir of callDirs) {
      if (!callDir.isDirectory()) continue
      const metaPath = join(callTypePath, callDir.name, 'meta.json')
      const meta = await fs
        .readFile(metaPath, 'utf-8')
        .then(JSON.parse)
        .catch(() => null) // call still in progress (no meta.json yet) or unreadable — skip
      if (meta) metas.push(meta)
    }
  }

  return metas
}

// Aggregates call activity over an arbitrary [startMs, endMs] window —
// shared by the Dials/Answered header badge (today only, see
// getTodayCallMetrics below) and the Cost Report's rep-chosen date range
// (see costReport.js).
export async function computeCallMetrics(dataRoot, { startMs, endMs }) {
  const metas = await readAllCallMeta(dataRoot)

  let dialsMade = 0
  let callsAnswered = 0
  let conversations = 0
  let offerMade = 0
  let offerDeclined = 0
  const propertiesWorked = new Set()

  for (const meta of metas) {
    if (!meta.startedAt || !isInRange(meta.startedAt, startMs, endMs)) continue

    dialsMade++
    const durationMs = meta.endedAt ? new Date(meta.endedAt) - new Date(meta.startedAt) : 0
    if (durationMs >= ANSWERED_THRESHOLD_MS) callsAnswered++
    if (durationMs >= CONVERSATION_THRESHOLD_MS) conversations++

    if (meta.offerOutcome === 'offer-made') offerMade++
    else if (meta.offerOutcome === 'offer-declined') offerDeclined++

    // Keyed by id when it's a saved property, else by its label (a Quick
    // Call with neither isn't "a property" to count as worked).
    const propertyKey = meta.property?.id || (meta.property?.label ? `label:${meta.property.label}` : null)
    if (propertyKey) propertiesWorked.add(propertyKey)
  }

  return {
    dialsMade,
    callsAnswered,
    conversations,
    offerMade,
    offerDeclined,
    propertiesWorked: propertiesWorked.size
  }
}

export async function getTodayCallMetrics(dataRoot) {
  return computeCallMetrics(dataRoot, todayRangeMs())
}

// How many times each phone number has been dialed, and on what dates —
// for PropertyPanel's per-number call history. Keyed by the exact dialed
// number string (same convention as properties.js's detectDispositions),
// not normalized, since that's what's actually stored in meta.json.
export async function getPhoneCallHistory(dataRoot) {
  const metas = await readAllCallMeta(dataRoot)
  const history = {}

  for (const meta of metas) {
    const number = meta.property?.dialedNumber
    if (!number || !meta.startedAt) continue
    if (!history[number]) history[number] = { count: 0, dates: [] }
    history[number].count++
    history[number].dates.push(meta.startedAt)
  }

  for (const entry of Object.values(history)) {
    entry.dates.sort((a, b) => new Date(b) - new Date(a)) // newest first
  }

  return history
}
