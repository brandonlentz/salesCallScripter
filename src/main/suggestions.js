import Anthropic from '@anthropic-ai/sdk'
import { NEPQ_SYSTEM_PROMPT } from './nepqPrompt.js'
import { NEPQ_STAGE_IDS } from '../shared/nepqStages.js'

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

// Given the rolling transcript text of a call (live or replayed in Training
// Mode), ask Claude which NEPQ stage the call is in and what to say/ask next.
export async function getSuggestions(transcriptText) {
  const anthropic = getClient()
  if (!anthropic) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.'
    )
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 500,
    system: NEPQ_SYSTEM_PROMPT,
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

  return parseSuggestionResponse(raw)
}

function parseSuggestionResponse(raw) {
  // Claude is instructed to return bare JSON, but strip markdown fences
  // defensively in case it wraps the response anyway.
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Suggestion engine returned unparseable output: ${raw.slice(0, 200)}`)
  }

  if (!NEPQ_STAGE_IDS.includes(parsed.stage)) {
    throw new Error(`Suggestion engine returned an unknown stage: ${parsed.stage}`)
  }

  return {
    stage: parsed.stage,
    stageRationale: parsed.stageRationale ?? '',
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
  }
}
