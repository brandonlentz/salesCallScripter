import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { computeCallMetrics } from './dailyMetrics.js'

// Reads the durable logs usageTracker.js/reisiftOutbound.js append to
// (JSON Lines — one JSON object per line) and aggregates them over an
// arbitrary date range, for the "Cost Report" button (CostReportModal.jsx).
// Unlike UsageMeter's live session gauge, this has to survive app
// restarts and answer questions about days/weeks ago, hence reading from
// disk rather than any in-memory state.

async function readJsonlInRange(path, startMs, endMs) {
  let raw
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }

  const entries = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue // one corrupt/partial line (e.g. a write cut short by a crash) shouldn't break the whole report
    }
    if (entry.at >= startMs && entry.at <= endMs) entries.push(entry)
  }
  return entries
}

function emptyBucket() {
  return { requestCount: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}

function addToBucket(bucket, event) {
  bucket.requestCount += 1
  bucket.inputTokens += event.inputTokens ?? 0
  bucket.outputTokens += event.outputTokens ?? 0
  bucket.costUsd += event.costUsd ?? 0
}

// `startDate`/`endDate` are 'YYYY-MM-DD' strings (from the report modal's
// native date inputs) — treated as a full local-calendar-day range,
// inclusive on both ends, since that's what a rep picking "Sep 1 to Sep 7"
// actually means.
//
// `dataRoot` is where recordings/ lives (see index.js — appRootDir in dev,
// userData once packaged), passed in separately from usage/zap logs below
// since those always live in userData regardless of dev/packaged.
export async function generateCostReport({ startDate, endDate, dataRoot }) {
  const startMs = new Date(`${startDate}T00:00:00`).getTime()
  const endMs = new Date(`${endDate}T23:59:59.999`).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error('Invalid date range.')
  }

  const userDataDir = app.getPath('userData')
  const [usageEvents, zapEntries, callMetrics] = await Promise.all([
    readJsonlInRange(join(userDataDir, 'usageLog.jsonl'), startMs, endMs),
    readJsonlInRange(join(userDataDir, 'zapLog.jsonl'), startMs, endMs),
    computeCallMetrics(dataRoot, { startMs, endMs })
  ])

  const suggestions = emptyBucket()
  const callAnalysis = emptyBucket()
  // Everything else (nepq-reference-parse, script-variant-parse,
  // property-parse) — one-off admin/setup actions, not part of the
  // per-call cost story, but still real spend, so still counted.
  const other = emptyBucket()

  for (const event of usageEvents) {
    if (event.source === 'suggestion') addToBucket(suggestions, event)
    else if (event.source === 'call-analysis') addToBucket(callAnalysis, event)
    else addToBucket(other, event)
  }

  const totalCostUsd = suggestions.costUsd + callAnalysis.costUsd + other.costUsd
  const zapsFired = zapEntries.filter((e) => e.success).length
  const zapsFailed = zapEntries.filter((e) => !e.success).length

  return {
    startDate,
    endDate,
    suggestions,
    callAnalysis,
    other,
    totalCostUsd,
    zapsFired,
    zapsFailed,
    ...callMetrics
  }
}
