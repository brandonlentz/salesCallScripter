import Anthropic from '@anthropic-ai/sdk'

// Same field set as the manual form in PropertyPanel.jsx / the local store
// in properties.js.
const PROPERTY_FIELDS = [
  'label',
  'contactName',
  'contactPhone',
  'contactRelationship',
  'deceasedName',
  'propertyAddress',
  'taxStatus',
  'caseNumber',
  'knownHeirs',
  'priorContactNotes',
  'offerAmount',
  'painPointsSummary'
]

// Structured outputs (not "respond with ONLY JSON" prompting) so the
// result is guaranteed to parse — no repeat of the truncated-JSON bug the
// suggestion engine hit. additionalProperties: false + every field in
// `required` is what Anthropic's structured-outputs support requires;
// "required" here just means "always present in the output", not "always
// non-empty" — the prompt tells the model to use "" when a field isn't in
// the pasted text.
const PROPERTY_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(PROPERTY_FIELDS.map((field) => [field, { type: 'string' }])),
  required: PROPERTY_FIELDS,
  additionalProperties: false
}

const SYSTEM_PROMPT = `You extract property/lead details from raw text a user pasted from their \
real estate CRM (REISift). The text may be messy — page chrome, button labels, timestamps, \
unrelated boilerplate — pull out only real values for these fields:

- label: a short name for this case — the deceased owner's name + " Estate", or the property \
street address if no owner name is present
- contactName: who to call (the heir, associate, or other contact)
- contactPhone: their phone number
- contactRelationship: their relationship to the deceased (e.g. "daughter", "neighbor", "attorney")
- deceasedName: the deceased property owner's name
- propertyAddress: the property's street address
- taxStatus: tax or legal status notes (e.g. "active foreclosure filed 2024")
- caseNumber: any case/file/parcel number
- knownHeirs: comma-separated names of known heirs
- priorContactNotes: any notes about prior contact/outreach attempts
- offerAmount: any dollar offer amount mentioned
- painPointsSummary: notes on the seller's motivations/pain points, if mentioned

Only extract what's actually present in the text — never invent, guess, or infer a value that \
isn't there. Use an empty string for any field the text doesn't mention.`

let client = null

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

// Parses raw text copied from REISift into a property draft matching
// PROPERTY_FIELDS. Caller (PropertyPanel.jsx) merges the result into the
// form for the user to review/correct before saving — this is a
// convenience fill, not a silent auto-save.
export async function parsePropertyText(rawText) {
  const anthropic = getClient()
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.')
  }
  if (!rawText?.trim()) {
    throw new Error('Paste some text first.')
  }

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: PROPERTY_SCHEMA } },
    // Generous cap — a REISift page's visible text is a few thousand
    // characters at most; this just guards against pasting something huge.
    messages: [{ role: 'user', content: rawText.trim().slice(0, 20000) }]
  })

  const block = message.content.find((b) => b.type === 'text')
  if (!block) {
    throw new Error('Parser returned no output.')
  }

  try {
    return JSON.parse(block.text)
  } catch {
    throw new Error(`Parser returned unparseable output: ${block.text.slice(0, 200)}`)
  }
}
