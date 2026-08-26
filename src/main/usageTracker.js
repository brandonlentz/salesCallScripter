// Tracks Claude API token usage/cost across every call site in this app
// (suggestions.js on the live-call critical path, plus the one-off
// callAnalysis/parseProperty/parseScriptVariant/parseNepqReference calls)
// so the rep can watch spend accumulate in real time instead of only
// finding out from the Anthropic console after the fact. Session-only —
// resets on app restart, deliberately: this is a live cost gauge, not a
// billing ledger (see console.anthropic.com/settings/billing for that).
//
// Pricing is USD per 1M tokens, snapshotted from Anthropic's published
// rates at the models this app actually calls. Update here if pricing
// changes or a new model/call site is added.
const PRICING = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-opus-5': { input: 5.0, output: 25.0 }
}
// Cache tokens are priced relative to that model's input rate — writing to
// cache costs more than a plain input token (you're paying to store it),
// reading from cache costs a fraction of it. These are Anthropic's standard
// cache pricing multipliers, not specific to any one model.
const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1

// Bounds the feed shown in the UI — this is a live glance, not a full audit
// log, so older entries just fall off (the running totals below keep
// accumulating regardless).
const MAX_EVENTS = 50

let getMainWindow = null
const totals = {
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  costUsd: 0
}
const events = []

function costFor(model, usage) {
  const pricing = PRICING[model]
  if (!pricing) return 0 // unknown model — don't guess a price, just don't add to cost
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  return (
    (input * pricing.input +
      output * pricing.output +
      cacheWrite * pricing.input * CACHE_WRITE_MULTIPLIER +
      cacheRead * pricing.input * CACHE_READ_MULTIPLIER) /
    1_000_000
  )
}

// Call once at startup (see index.js) so recordUsage can push live updates
// to the renderer — same lazy-getter pattern liveCall.js uses for
// mainWindow, since the window doesn't exist yet when handlers are wired up.
export function initUsageTracker(getWindow) {
  getMainWindow = getWindow
}

// `source` identifies which feature made the call (e.g. 'suggestion',
// 'call-analysis') — shown in the UI feed so a rep can tell a live-call
// suggestion apart from a one-off property parse. `usage` is the Anthropic
// SDK response's `.usage` object; missing/malformed usage is silently
// skipped rather than throwing — this must never break the API call it's
// piggybacking on.
export function recordUsage({ source, model, usage }) {
  if (!usage) return

  const cost = costFor(model, usage)
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    source,
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    costUsd: cost
  }

  totals.requestCount += 1
  totals.inputTokens += event.inputTokens
  totals.outputTokens += event.outputTokens
  totals.cacheCreationInputTokens += event.cacheCreationInputTokens
  totals.cacheReadInputTokens += event.cacheReadInputTokens
  totals.costUsd += cost

  events.unshift(event)
  events.length = Math.min(events.length, MAX_EVENTS)

  getMainWindow?.()?.webContents.send('usage:update', { event, totals: { ...totals } })
}

// Seeds the renderer's state on mount — the push above only reaches a
// window that's already listening, so a panel opened mid-session still
// needs a one-shot pull of what happened before it mounted.
export function getUsageSnapshot() {
  return { totals: { ...totals }, events: [...events] }
}
