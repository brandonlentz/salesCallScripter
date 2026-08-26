import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Local, file-based store for property/lead context (deceased owner, tax
// status, known heirs, prior contact notes, etc.) that the suggestion
// engine uses to ground its coaching in the specific call, not just the
// generic script.
//
// This is deliberately NOT a REISift API integration — REISift doesn't
// publish a documented pull/search API, so for now entries are added here
// manually (copy details over from REISift before a call), the same
// workflow the older call-tracker project used. The field shape below
// mirrors call-tracker's PreCallDetails/SavedCase so a future REISift
// sync (via their Zapier action or native Webhooks) can populate this same
// store without changing anything downstream.
//
// Stored entirely outside the repo (Electron's userData dir) and never
// committed — these records contain seller PII.
function storePath() {
  return join(app.getPath('userData'), 'properties.json')
}

// Records saved before multi-contact support only had a single
// contactName/contactPhone/contactRelationship. Normalize those into the
// contacts[] shape on read so every caller (search, the UI) only ever sees
// one shape — no persisted migration needed, this just runs on load and
// the new shape gets written back naturally the next time the record is
// saved.
function migrateContacts(property) {
  if (Array.isArray(property.contacts)) return property
  const { contactName, contactPhone, contactRelationship, ...rest } = property
  const hasLegacyContact = contactName || contactPhone || contactRelationship
  return {
    ...rest,
    contacts: hasLegacyContact
      ? [
          {
            name: contactName ?? '',
            relationship: contactRelationship ?? '',
            phones: contactPhone ? [{ number: contactPhone, label: '' }] : []
          }
        ]
      : []
  }
}

async function readAll() {
  try {
    const raw = await fs.readFile(storePath(), 'utf-8')
    return JSON.parse(raw).map(migrateContacts)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

async function writeAll(properties) {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(storePath(), JSON.stringify(properties, null, 2))
}

export async function listProperties() {
  const properties = await readAll()
  return properties.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function searchProperties(query) {
  const properties = await listProperties()
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return properties
  return properties.filter((p) => {
    const contactFields = (p.contacts ?? []).flatMap((c) => [
      c.name,
      c.relationship,
      ...(c.phones ?? []).map((ph) => ph.number)
    ])
    return [p.label, p.propertyAddress, p.deceasedName, ...contactFields]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(q))
  })
}

export async function saveProperty(data) {
  if (!data.label?.trim()) {
    throw new Error('Property needs a label (e.g. "Torres Estate").')
  }
  const properties = await readAll()
  const property = { ...data, id: randomUUID(), updatedAt: Date.now() }
  properties.push(property)
  await writeAll(properties)
  return property
}

export async function updateProperty(id, data) {
  const properties = await readAll()
  const index = properties.findIndex((p) => p.id === id)
  if (index === -1) {
    throw new Error(`Property not found: ${id}`)
  }
  const updated = { ...properties[index], ...data, id, updatedAt: Date.now() }
  properties[index] = updated
  await writeAll(properties)
  return updated
}

export async function deleteProperty(id) {
  const properties = await readAll()
  await writeAll(properties.filter((p) => p.id !== id))
}

// --- REISift webhook sync (see reisiftWebhook.js) -------------------------
//
// REISift now delivers property records live via an outbound webhook
// instead of the old paste-and-parse flow (see the README's Property
// Context section). Records are matched by REISift's own `property.uuid`,
// not our local `id`, so the same property gets updated in place no matter
// how many times REISift re-fires a sequence for it.
//
// Field ownership is split so a sync never clobbers work a rep already did
// in this app: REISift owns identity/facts (address, tax/legal dates,
// contacts, its own status/tags), the rep owns judgment calls (property
// label once set, offer amount, pain points, and each phone's call-outcome
// tag — see PropertyPanel's PHONE_STATUSES) unless REISift reports a hard
// compliance signal (owner.dnc) that has to win regardless.

function formatReisiftAddress(addr) {
  if (!addr) return ''
  return [addr.street, addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')
}

// Short human-readable string built from whichever legal/tax milestone
// dates REISift has on file — there's no single "tax status" field in
// their payload, just a scatter of date fields, most of which are null for
// any given property.
function summarizeReisiftTaxStatus(p) {
  const bits = []
  if (p.tax_delinquent_year) bits.push(`Tax delinquent since ${p.tax_delinquent_year}`)
  if (p.foreclosure_date) bits.push(`Foreclosure filed ${p.foreclosure_date}`)
  if (p.auction_date) bits.push(`Auction date ${p.auction_date}`)
  if (p.bankruptcy_recording_date) bits.push(`Bankruptcy recorded ${p.bankruptcy_recording_date}`)
  if (p.probate_open_date) bits.push(`Probate opened ${p.probate_open_date}`)
  if (p.lien_recording_date) bits.push(`Lien recorded ${p.lien_recording_date}`)
  return bits.join('; ')
}

// One REISift owner (the primary `owner` or one of `secondary_owners`)
// into our contact shape. `owner.dnc` forces every one of their numbers to
// our own 'dnc' status — see mergePhone below for why that's the one field
// a sync is allowed to override unconditionally.
function mapReisiftOwnerToContact(owner, relationship) {
  if (!owner) return null
  const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ').trim() || owner.company || ''
  return {
    reisiftUuid: owner.uuid,
    name,
    relationship,
    deceased: !!owner.deceased,
    phones: (owner.phones ?? [])
      .filter((p) => p.number)
      .map((p) => ({
        number: p.number,
        label: (p.tags ?? []).join(', '),
        status: owner.dnc ? 'dnc' : ''
      }))
  }
}

// Raw `property` object from the webhook payload (see the sample in the
// README/commit history) into our local property shape.
function mapReisiftProperty(raw) {
  const ownerContact = mapReisiftOwnerToContact(raw.owner, 'owner')
  const secondaryContacts = (raw.secondary_owners ?? [])
    .map((o) => mapReisiftOwnerToContact(o, 'secondary owner'))
    .filter(Boolean)

  return {
    reisiftUuid: raw.uuid,
    label: ownerContact?.name || formatReisiftAddress(raw.address) || 'Untitled property',
    propertyAddress: formatReisiftAddress(raw.address),
    deceasedName: ownerContact?.deceased ? ownerContact.name : '',
    taxStatus: summarizeReisiftTaxStatus(raw),
    knownHeirs: secondaryContacts.map((c) => c.name).filter(Boolean).join(', '),
    priorContactNotes: raw.notes ?? '',
    reisiftStatus: raw.status ?? '',
    reisiftTags: raw.tags ?? [],
    reisiftLists: raw.lists ?? [],
    contacts: [ownerContact, ...secondaryContacts].filter(Boolean)
  }
}

// Merges one freshly-synced phone onto whatever we already have for that
// number. A rep's own call-outcome tag is local-only and survives re-syncs
// — except a REISift-reported DNC always wins, since that's a compliance
// signal, not a coaching note.
function mergePhone(existingPhones, incoming) {
  const existing = existingPhones.find((p) => p.number === incoming.number)
  if (!existing) return { number: incoming.number, label: incoming.label, status: incoming.status || '' }
  return {
    ...existing,
    label: incoming.label || existing.label,
    status: incoming.status === 'dnc' ? 'dnc' : existing.status
  }
}

// Merges REISift-sourced contacts onto the existing contacts array,
// matched by REISift's own owner uuid so identity survives a name
// correction upstream. Additive only — a sync never removes a contact or
// phone, since one payload not mentioning someone isn't proof they're gone.
function mergeReisiftContacts(existingContacts, incomingContacts) {
  const merged = existingContacts.map((c) => ({ ...c, phones: [...(c.phones ?? [])] }))

  for (const incoming of incomingContacts) {
    const index = merged.findIndex((c) => c.reisiftUuid === incoming.reisiftUuid)
    if (index === -1) {
      merged.push({ ...incoming })
      continue
    }
    const existing = merged[index]
    const existingPhones = existing.phones ?? []
    const seenNumbers = new Set(existingPhones.map((p) => p.number))
    const phones = existingPhones.map((p) => {
      const incomingPhone = incoming.phones.find((ip) => ip.number === p.number)
      return incomingPhone ? mergePhone(existingPhones, incomingPhone) : p
    })
    for (const incomingPhone of incoming.phones) {
      if (!seenNumbers.has(incomingPhone.number)) {
        phones.push(mergePhone(existingPhones, incomingPhone))
      }
    }
    merged[index] = { ...existing, name: incoming.name || existing.name, phones }
  }

  return merged
}

// Entry point for the webhook receiver. Looks up by `reisiftUuid` (not our
// local `id`, which REISift knows nothing about) — creates a new property
// the first time this uuid is seen, merges onto the existing one otherwise.
export async function upsertPropertyFromReisift(rawReisiftProperty) {
  const mapped = mapReisiftProperty(rawReisiftProperty)
  const properties = await readAll()
  const index = properties.findIndex((p) => p.reisiftUuid === mapped.reisiftUuid)

  if (index === -1) {
    const property = {
      ...mapped,
      id: randomUUID(),
      caseNumber: '',
      offerAmount: '',
      painPointsSummary: '',
      updatedAt: Date.now()
    }
    properties.push(property)
    await writeAll(properties)
    return { created: true, property }
  }

  const existing = properties[index]
  const updated = {
    ...existing,
    // Label is rep-owned once set (e.g. renamed to "Torres Estate") — a
    // sync only fills it in while it's still blank.
    label: existing.label?.trim() ? existing.label : mapped.label,
    propertyAddress: mapped.propertyAddress || existing.propertyAddress,
    deceasedName: mapped.deceasedName || existing.deceasedName,
    taxStatus: mapped.taxStatus || existing.taxStatus,
    knownHeirs: mapped.knownHeirs || existing.knownHeirs,
    // property.notes is REISift's own free-text field, not the rep's — only
    // seed our notes box with it while the rep hasn't written anything yet.
    priorContactNotes: existing.priorContactNotes?.trim()
      ? existing.priorContactNotes
      : mapped.priorContactNotes,
    reisiftStatus: mapped.reisiftStatus,
    reisiftTags: mapped.reisiftTags,
    reisiftLists: mapped.reisiftLists,
    contacts: mergeReisiftContacts(existing.contacts ?? [], mapped.contacts),
    updatedAt: Date.now()
  }
  properties[index] = updated
  await writeAll(properties)
  return { created: false, property: updated }
}
