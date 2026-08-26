import Anthropic from '@anthropic-ai/sdk'
import { recordUsage } from './usageTracker.js'

// Distills an uploaded PDF (NEPQ framework material — Jeremy Miner training
// docs or similar) into organized reference notes for the suggestion
// engine's system prompt (see nepqPrompt.js). Deliberately NOT a verbatim
// transcription: the whole document has to fit efficiently into a prompt
// sent on every suggestion request, so this asks Claude to distill the
// actual reusable coaching guidance rather than reproduce every page.
//
// Uses Claude's native PDF understanding (a `document` content block) —
// no separate OCR/text-extraction step needed, same approach as sending an
// image, just a different content-block type.
const SYSTEM_PROMPT = `You distill sales training material into concise reference notes for a \
live-call coaching system. The uploaded PDF is training content on Jeremy Miner's NEPQ \
(Neuro-Emotional Persuasion Questioning) framework, or something similar — question-based, \
curiosity-led selling that uncovers pain before pitching.

Extract and organize the REUSABLE METHODOLOGY, not a transcription of the document: core \
principles, the actual question patterns/types taught (with examples where the source gives \
them), how objections are handled, tonality/pacing guidance, and any named frameworks or \
sequences. Use clear headings and bullet points. Skip filler, stories, and anything that's not \
actionable guidance — this needs to stay compact enough to include in a prompt on every request, \
not reproduce the whole book. If the PDF contains multiple distinct frameworks or sections, keep \
their structure recognizable under separate headings rather than blending everything together.

Output plain text (headings and bullets are fine, no markdown code fences, no JSON).`

let client = null

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

// Parses one PDF's `base64` data into distilled reference text. Caller
// (NepqReferencePanel.jsx) shows the result for review before saving via
// nepqReferences.js — same review-before-save pattern as
// parseScriptVariant.js and parsePropertyText.
export async function parseNepqReference(base64, filename) {
  const anthropic = getClient()
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.')
  }
  if (!base64) {
    throw new Error('No PDF data to parse.')
  }

  const message = await anthropic.messages.create({
    // One-time processing of a whole reference document, not a per-call
    // latency-sensitive request (unlike suggestions.js) — worth the
    // stronger model for extraction quality, since this content grounds
    // every suggestion made afterward.
    model: 'claude-opus-5',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          { type: 'text', text: `Distill this into NEPQ reference notes: ${filename ?? 'uploaded PDF'}` }
        ]
      }
    ]
  })

  recordUsage({ source: 'nepq-reference-parse', model: 'claude-opus-5', usage: message.usage })

  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      'Extraction was cut off before finishing (the document may be too dense/long to distill in one pass).'
    )
  }

  const block = message.content.find((b) => b.type === 'text')
  if (!block?.text?.trim()) {
    throw new Error('Extraction returned no content — the PDF may be empty, scanned images with no text, or unreadable.')
  }

  return { content: block.text.trim() }
}
