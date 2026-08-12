import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from './nepqPrompt.js'
import { CALL_TYPES, getStageIds } from '../shared/callScripts.js'

const MAX_TOKENS = 700

let client = null

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

// Given the call type and the rolling transcript text of a call (live or
// replayed in Training Mode), ask Claude which stage of that call's script
// the call is in and which lines from the script to surface next.
export async function getSuggestions(transcriptText, callType) {
  if (!CALL_TYPES.includes(callType)) {
    throw new Error(`Unknown call type: ${callType}`)
  }

  const anthropic = getClient()
  if (!anthropic) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.'
    )
  }

  const message = await anthropic.messages.create({
    // Haiku 4.5: this is on the critical path of a live call (target is a
    // suggestion within 1-2s of the prospect finishing a sentence), and it's
    // a bounded classification/retrieval task grounded in the fixed call
    // script, not open-ended reasoning — Haiku is fast enough for that and
    // doesn't think unless asked, so there's no thinking/effort param to set
    // (effort isn't supported on this model; omitting `thinking` is its
    // "off" state).
    model: 'claude-haiku-4-5',
    // Headroom above what 2-3 short suggestions should need (see
    // nepqPrompt.js) — the prompt enforces brevity, this is a backstop so a
    // stray verbose response gets a clear error instead of truncated JSON.
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(callType),
        // The script text is identical on every request for a given call
        // type, so mark it cacheable. Note: Haiku 4.5's minimum cacheable
        // prefix is 4096 tokens, and a single call type's script usually
        // runs under that, so this may not actually hit cache today — left
        // in since it's free and starts paying off if the scripts grow.
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content: `Transcript so far:\n\n${transcriptText}`
      }
    ]
  })

  const raw = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()

  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `Suggestion engine response was cut off (hit the ${MAX_TOKENS}-token limit) before finishing.`
    )
  }

  return parseSuggestionResponse(raw, callType)
}

function parseSuggestionResponse(raw, callType) {
  // Claude is instructed to return bare JSON, but strip markdown fences
  // defensively in case it wraps the response anyway.
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Suggestion engine returned unparseable output: ${raw.slice(0, 200)}`)
  }

  if (!getStageIds(callType).includes(parsed.stage)) {
    throw new Error(`Suggestion engine returned an unknown stage: ${parsed.stage}`)
  }

  return {
    stage: parsed.stage,
    stageRationale: parsed.stageRationale ?? '',
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
  }
}
