import Anthropic from '@anthropic-ai/sdk'
import { CALL_SCRIPTS } from '../shared/callScripts.js'
import { getAllReferenceContent } from './nepqReferences.js'
import { recordUsage } from './usageTracker.js'

// Post-call coaching analysis: grades the rep's performance on a finished
// call transcript against Jeremy Miner's NEPQ framework, shown in the
// call-summary popup right after End Call (see CallSummaryModal.jsx). This
// is a one-time analysis per call, not on the live-call critical path like
// suggestions.js — worth the stronger model, same reasoning as
// parseNepqReference.js.
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    // No min/max here — Claude's structured-output schema rejects
    // minimum/maximum on integer properties ("not supported"). The 1-10
    // range is enforced by the system prompt instruction instead; parsed
    // below with a defensive clamp in case the model ever drifts outside it.
    score: { type: 'integer' },
    summary: { type: 'string' },
    wentWell: { type: 'array', items: { type: 'string' } },
    wentPoorly: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } }
  },
  required: ['score', 'summary', 'wentWell', 'wentPoorly', 'improvements'],
  additionalProperties: false
}

function buildSystemPrompt(callType, referenceContent) {
  const referenceSection = referenceContent.length
    ? `\n\nSupplementary NEPQ framework notes uploaded by the rep, use these to inform your \
grading criteria specifically (question style, tonality, objection handling):\n\n${referenceContent.join('\n\n---\n\n')}`
    : ''

  return `You grade a sales rep's performance on one finished call, transcribed with speaker \
labels. The rep works for Pickle Deeds (pickledeeds.com), buying properties with title issues \
from owners/heirs, calling on a "${callType}" script. Grade against Jeremy Miner's NEPQ \
(Neuro-Emotional Persuasion Questioning) framework: leading with curiosity, uncovering pain \
before pitching, question-based (not pitch-based) selling, tonality/pacing, and effective \
objection handling.

REFERENCE SCRIPT for this call type (what the ideal flow covers, not a requirement to quote \
verbatim):

${CALL_SCRIPTS[callType].map((s) => `### ${s.title}\n${s.lines.join('\n')}`).join('\n\n')}${referenceSection}

Score 1-10 (10 = textbook NEPQ execution). Be specific and honest — cite what the rep actually \
said (or should have said) rather than generic advice. If the transcript is too short/garbled to \
judge fairly, say so in the summary and score conservatively rather than inventing detail.

wentWell / wentPoorly / improvements: 2-5 short bullet points each, one sentence per bullet, \
concrete and actionable (not "be more confident" — instead "you jumped to the offer before the \
prospect named a specific pain point").`
}

let client = null

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

export async function analyzeCall(transcriptText, callType) {
  const anthropic = getClient()
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.')
  }
  if (!transcriptText?.trim()) {
    throw new Error('No transcript to analyze.')
  }
  if (!CALL_SCRIPTS[callType]) {
    throw new Error(`Unknown call type: ${callType}`)
  }

  const referenceContent = await getAllReferenceContent()

  const message = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    system: buildSystemPrompt(callType, referenceContent),
    output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
    messages: [{ role: 'user', content: `Call transcript:\n\n${transcriptText}` }]
  })

  recordUsage({ source: 'call-analysis', model: 'claude-opus-5', usage: message.usage })

  if (message.stop_reason === 'max_tokens') {
    throw new Error('Call analysis was cut off before finishing.')
  }

  const block = message.content.find((b) => b.type === 'text')
  if (!block) {
    throw new Error('Call analysis returned no output.')
  }

  let parsed
  try {
    parsed = JSON.parse(block.text)
  } catch {
    throw new Error(`Call analysis returned unparseable output: ${block.text.slice(0, 200)}`)
  }

  return { ...parsed, score: Math.min(10, Math.max(1, Math.round(parsed.score))) }
}
