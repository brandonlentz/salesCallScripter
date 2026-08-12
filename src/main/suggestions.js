import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from './nepqPrompt.js'
import { CALL_TYPES, getStageIds } from '../shared/callScripts.js'

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
    model: 'claude-sonnet-5',
    max_tokens: 500,
    // This is a bounded classification/retrieval task grounded in the fixed
    // call script (not open-ended reasoning), and it's on the critical path
    // of a live call — skip extended thinking and keep effort low so a
    // suggestion comes back in a second or two, not several.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(callType),
        // The script text is identical on every request for a given call
        // type — cache it so repeat requests only pay for the (short)
        // rolling transcript instead of reprocessing the whole script.
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
