import Anthropic from '@anthropic-ai/sdk'
import { recordUsage } from './usageTracker.js'

// A script variant's sections are the same {stage, title, lines} shape as
// the hardcoded CALL_SCRIPTS in shared/callScripts.js — see formatScript()
// in nepqPrompt.js, which renders that exact shape into
// "### stage — title\nline\nline" markdown. This parser is the inverse: it
// turns pasted text (which may already be in that format, or may be much
// messier — notes, a rough draft, a transcript of source material) into
// structured sections.
const SECTION_SCHEMA = {
  type: 'object',
  properties: {
    stage: { type: 'string' },
    title: { type: 'string' },
    lines: { type: 'array', items: { type: 'string' } }
  },
  required: ['stage', 'title', 'lines'],
  additionalProperties: false
}

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    sections: { type: 'array', items: SECTION_SCHEMA }
  },
  required: ['sections'],
  additionalProperties: false
}

const SYSTEM_PROMPT = `You structure a sales call script into stage sections for a live-call \
teleprompter. The pasted text may already be organized this way — headings like \
"### Opening — Pattern Interrupt" followed by script lines — or it may be much rougher: notes, \
a rough draft, or a transcript pulled from other source material. Either way, break it into \
sections, each with:

- stage: a short, stable, kebab-case id for this beat of the call (e.g. "opening", \
"permission", "discovery", "objection") — lowercase, hyphen-separated, no spaces or punctuation
- title: a short human-readable label for the section (e.g. "Opening — Pattern Interrupt")
- lines: the actual word-for-word script lines for this section, in the order they're meant to \
be said, as an array of strings

Preserve the wording of actual script lines exactly as given — this is a word-for-word call \
script, not a paraphrase or summary. Group lines into sections by the natural beats of the call \
(opening, building rapport, asking questions, handling objections, closing, etc.) using your \
judgment when the input doesn't already have clear headings. Don't invent lines, stages, or \
content that isn't in the pasted text — if the input is sparse, return sparse output.`

let client = null

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

// Parses pasted/drafted script text into { sections }. Caller
// (ScriptVariantPanel.jsx) shows the result for review before saving as a
// new variant via scriptVariants.js — a convenience fill, not a silent
// auto-save, same as parsePropertyText.
export async function parseScriptVariant(rawText) {
  const anthropic = getClient()
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.')
  }
  if (!rawText?.trim()) {
    throw new Error('Paste some script text first.')
  }

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    // A full multi-stage script (see the built-in INTRO_SCRIPT) runs a few
    // hundred tokens in, and structured JSON out roughly doubles that with
    // property-name/array overhead — this is headroom, not a target.
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: SCRIPT_SCHEMA } },
    messages: [{ role: 'user', content: rawText.trim().slice(0, 150000) }]
  })

  recordUsage({ source: 'script-variant-parse', model: 'claude-haiku-4-5', usage: message.usage })

  if (message.stop_reason === 'max_tokens') {
    throw new Error('Parser response was cut off before finishing — try pasting a shorter script.')
  }

  const block = message.content.find((b) => b.type === 'text')
  if (!block) {
    throw new Error('Parser returned no output.')
  }

  let parsed
  try {
    parsed = JSON.parse(block.text)
  } catch {
    throw new Error(`Parser returned unparseable output: ${block.text.slice(0, 200)}`)
  }

  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error('Parser found no script sections in that text.')
  }

  return parsed
}
