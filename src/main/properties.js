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
