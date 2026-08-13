import { CALL_SCRIPTS, getStageIds } from '../shared/callScripts.js'

function formatScript(sections) {
  return sections
    .map((section) => `### ${section.stage} — ${section.title}\n${section.lines.join('\n')}`)
    .join('\n\n')
}

// System prompt for the suggestion engine, one per call type/script variant.
// Built around Jeremy Miner's NEPQ (Neuro-Emotional Persuasion Questioning)
// principles — lead with curiosity, uncover pain before pitching, let
// silence work — but grounded in the salesperson's actual word-for-word
// call script rather than generic NEPQ theory, so suggestions sound like
// the rep, not like an AI.
//
// `sections` is a script variant's own sections (see scriptVariants.js),
// defaulting to the builtin script so callers that haven't been updated to
// pass a variant explicitly keep working.
export function buildSystemPrompt(callType, sections = CALL_SCRIPTS[callType]) {
  const stageIds = getStageIds(callType, sections)

  return `You are a real-time sales call coach for a rep at Pickle Deeds (pickledeeds.com), a \
Texas company that buys properties with title issues (heir disputes, probate, clouded titles) \
from owners and heirs. Tagline: "Turning Title Issues Into Opportunities For Owners and Heirs." \
This is a "${callType}" call.

The rep has a specific word-for-word script for this call type, broken into stages. Treat it \
as ground truth for what to say next — your job is to figure out which stage the call is \
actually in right now and surface the most relevant lines from the script, adapted only as \
much as the live conversation requires (e.g. filling in [PLACEHOLDER]s from context, skipping \
a line that's already been covered). Prefer quoting the script closely over inventing new \
phrasing. Where the script calls for silence or a pause, say so explicitly in the suggestion.

SCRIPT:

${formatScript(sections)}

You will be given the rolling transcript of the live call, oldest to newest. It may be raw \
speech-to-text output without speaker labels or punctuation cleanup — do your best to infer \
who said what from context and how far into the script they've gotten.

Respond with ONLY a JSON object, no prose, no markdown fences, matching this shape:

{
  "stage": one of ${JSON.stringify(stageIds)},
  "stageRationale": "under 10 words on why the call is at this stage right now",
  "suggestions": [
    { "type": "question" | "response", "text": "..." }
  ]
}

Give exactly 2-3 suggestions: the next lines the rep should say. Each "text" is ONE sentence, \
under 25 words — even when the script's line for this beat runs longer, give only its next \
sentence, not the whole block; trust the rep to keep reading from there. This is a hard limit: \
the response must fit in a small token budget, so never quote a multi-sentence script passage \
into a single suggestion.`
}

// Formats a locally-saved property/lead record (see properties.js) into a
// short context block. This is NOT part of buildSystemPrompt() above — it's
// per-call, dynamic data (which property, which contact), so it goes in the
// user message instead. Putting it in the system prompt would change the
// system prompt on every property switch and invalidate the prompt cache
// that's keyed on the script text being byte-identical call to call.
export function buildPropertyContext(property) {
  if (!property) return ''

  const lines = ['=== PROPERTY CONTEXT (from REISift) ===']
  const field = (label, value) => {
    if (value) lines.push(`${label}: ${value}`)
  }

  for (const contact of property.contacts ?? []) {
    const who = [contact.name, contact.relationship].filter(Boolean).join(' — ')
    const numbers = (contact.phones ?? [])
      .map((p) => (p.label ? `${p.number} (${p.label})` : p.number))
      .join(', ')
    if (who || numbers) {
      lines.push(`Contact: ${[who, numbers].filter(Boolean).join(' — ')}`)
    }
  }
  field('Deceased owner', property.deceasedName)
  field('Property', property.propertyAddress)
  field('Tax/legal status', property.taxStatus)
  field('Case/file number', property.caseNumber)
  field('Known heirs', property.knownHeirs)
  field('Prior contact notes', property.priorContactNotes)
  field('Offer amount', property.offerAmount)
  field('Prior pain points', property.painPointsSummary)

  return lines.length > 1 ? lines.join('\n') : ''
}
