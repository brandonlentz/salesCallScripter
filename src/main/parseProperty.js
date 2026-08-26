import Anthropic from '@anthropic-ai/sdk'
import { recordUsage } from './usageTracker.js'

// Scalar fields — same as the manual form in PropertyPanel.jsx / the local
// store in properties.js. `contacts` is handled separately below since it's
// a nested array, not a plain string field.
const SCALAR_FIELDS = [
  'label',
  'deceasedName',
  'propertyAddress',
  'taxStatus',
  'caseNumber',
  'knownHeirs',
  'priorContactNotes',
  'offerAmount',
  'painPointsSummary'
]

// A CRM record commonly has several distinct people worth calling (heirs,
// spouses, associates), each with several phone numbers of their own — e.g.
// a REISift owner card lists a dozen numbers, each tagged with which
// specific person they belong to. `contacts` captures that as one entry per
// person, each with its own list of numbers, instead of collapsing
// everything into a single name/phone pair.
const CONTACT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    relationship: { type: 'string' },
    phones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'string' },
          label: { type: 'string' }
        },
        required: ['number', 'label'],
        additionalProperties: false
      }
    }
  },
  required: ['name', 'relationship', 'phones'],
  additionalProperties: false
}

// Structured outputs (not "respond with ONLY JSON" prompting) so the
// result is guaranteed to parse — no repeat of the truncated-JSON bug the
// suggestion engine hit. additionalProperties: false + every field in
// `required` is what Anthropic's structured-outputs support requires;
// "required" here just means "always present in the output", not "always
// non-empty" — the prompt tells the model to use "" (or [] for contacts)
// when a field isn't in the pasted text.
const PROPERTY_SCHEMA = {
  type: 'object',
  properties: {
    ...Object.fromEntries(SCALAR_FIELDS.map((field) => [field, { type: 'string' }])),
    contacts: { type: 'array', items: CONTACT_SCHEMA }
  },
  required: [...SCALAR_FIELDS, 'contacts'],
  additionalProperties: false
}

const SYSTEM_PROMPT = `You extract property/lead details from content a user pasted from their \
real estate CRM (REISift) — either the page's visible text, or its full HTML markup (tags, \
attributes, and all). Either way it'll be messy — page chrome, button labels, timestamps, \
script/style leftovers, unrelated boilerplate — pull out only real values for these fields:

- label: a short name for this case — the deceased owner's name + " Estate", or the property \
street address if no owner name is present
- contacts: everyone worth calling about this deal (heirs, spouses, associates, etc.), each as \
an object: { name, relationship (to the deceased, e.g. "daughter", "great niece", "neighbor"), \
phones: [{ number, label }] }. Group phone numbers under the right person, not just the first \
name you see — REISift often tags each number with whose it is (e.g. a tooltip, "tags popup", \
or "data-tip" reading like "Tiffany Reece - Darlene great niece"); use those tags to attribute \
numbers correctly, and put a person's several numbers under ONE contact entry, not one entry \
per number. "label" on a phone is whatever short descriptor is attached to it (e.g. "Wireless", \
"Mobile", "Primary") — use "" if none is given. If a name is mentioned with no phone number, \
still include them as a contact with an empty phones array — don't drop them.
- deceasedName: the deceased property owner's name
- propertyAddress: the property's street address
- taxStatus: tax or legal status notes (e.g. "active foreclosure filed 2024")
- caseNumber: any case/file/parcel number
- knownHeirs: comma-separated names of heirs mentioned WITHOUT enough detail to be their own \
contact entry (no phone, unclear relationship) — background context, not a call list
- priorContactNotes: any notes about prior contact/outreach attempts
- offerAmount: any dollar offer amount mentioned
- painPointsSummary: notes on the seller's motivations/pain points, if mentioned

Only extract what's actually present in the text — never invent, guess, or infer a value that \
isn't there. Use an empty string (or empty array for contacts/phones) for anything the text \
doesn't mention.`

let client = null

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

// If what was pasted is HTML (full-page copy, e.g. DevTools "Copy
// outerHTML"), strip the two tag types that are pure noise for extraction
// purposes — inline JS bundles and CSS can be enormous and add nothing —
// so the token budget goes toward actual page content. No-op on plain
// text: there's nothing for these patterns to match.
function stripHtmlNoise(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
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

  const cleaned = stripHtmlNoise(rawText.trim())

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: PROPERTY_SCHEMA } },
    // Plain visible-text paste is a few thousand characters; a full-page
    // HTML paste (markup, not scripts/styles — already stripped above) is
    // bigger but still well within this. Just a guard against pasting
    // something absurd, not a realistic ceiling for either input kind.
    messages: [{ role: 'user', content: cleaned.slice(0, 150000) }]
  })

  recordUsage({ source: 'property-parse', model: 'claude-haiku-4-5', usage: message.usage })

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
