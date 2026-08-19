import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt, buildPropertyContext } from './nepqPrompt.js'
import { CALL_TYPES, CALL_SCRIPTS, getStageIds } from '../shared/callScripts.js'
import { getVariant } from './scriptVariants.js'
import { getAllReferenceContent } from './nepqReferences.js'

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
// the call is in and which lines from the script to surface next. `property`
// is an optional locally-saved property/lead record (see properties.js) —
// pass null when no property is selected for this call. `variantId` selects
// which of that call type's script variants (see scriptVariants.js) is
// "live" for this request — defaults to the builtin 'original' script.
export async function getSuggestions(
  transcriptText,
  callType,
  property = null,
  variantId = 'original'
) {
  if (!CALL_TYPES.includes(callType)) {
    throw new Error(`Unknown call type: ${callType}`)
  }

  const anthropic = getClient()
  if (!anthropic) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.'
    )
  }

  // The 'original' variant is always seeded from CALL_SCRIPTS on first
  // read (see scriptVariants.js), but fall back to CALL_SCRIPTS directly
  // rather than hitting the store when it's the default — keeps the common
  // case (no variant picked) from depending on the userData store existing.
  const sections =
    variantId === 'original' ? CALL_SCRIPTS[callType] : (await getVariant(callType, variantId)).sections
  const referenceContent = await getAllReferenceContent()

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
        text: buildSystemPrompt(callType, sections, referenceContent),
        // The script text is identical on every request for a given call
        // type + variant, so mark it cacheable. Note: Haiku 4.5's minimum
        // cacheable prefix is 4096 tokens, and a single script usually runs
        // under that, so this may not actually hit cache today — left in
        // since it's free and starts paying off if scripts grow.
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content: [buildPropertyContext(property), `Transcript so far:\n\n${transcriptText}`]
          .filter(Boolean)
          .join('\n\n')
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

  return parseSuggestionResponse(raw, callType, sections)
}

function parseSuggestionResponse(raw, callType, sections) {
  // Claude is instructed to return bare JSON, but strip markdown fences
  // defensively in case it wraps the response anyway.
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Suggestion engine returned unparseable output: ${raw.slice(0, 200)}`)
  }

  if (!getStageIds(callType, sections).includes(parsed.stage)) {
    throw new Error(`Suggestion engine returned an unknown stage: ${parsed.stage}`)
  }

  return {
    stage: parsed.stage,
    stageRationale: parsed.stageRationale ?? '',
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
  }
}
