import { app } from 'electron'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toReisiftPhoneStatus } from './reisiftPhoneStatus.js'

// Outbound counterpart to reisiftWebhookSocket.js — that file receives
// REISift's data; this one sends this app's data back out. REISift doesn't
// publish a general inbound REST API, so the only documented way to push
// data *into* REISift is through its Zapier integration, which (per
// REISift's own docs) works exclusively as a Zapier Action — it receives
// data, it doesn't emit triggers.
//
// One event, fired the moment a phone is dispositioned (see properties.js's
// detectDispositions) — not three separate ones for "new contact"/"new
// phone"/"status changed". By the time a rep dispositions a call, the
// contact, the phone number, and the status are all known at once, and
// REISift's own action can create-or-update, so there's no need to
// distinguish "this is a brand-new number" from "this number already
// existed" on the way out — one Zap, one Catch Hook URL, covers all of it.
// See the README's "Pushing dispositions to REISift" section for the Zap
// setup.
//
// Only ever fires for a property REISift already knows about (has a
// reisiftUuid from a prior inbound sync) — there's no REISift record to
// attach anything to otherwise.
//
// Sent in real time, one item per push — no local batching/scheduling. If
// you want changes to land on a schedule instead, that's simpler to build
// on the Zapier side (e.g. Digest by Zapier) than duplicating scheduling
// logic here too.
//
// Uses Electron main process's built-in `fetch` — no new dependency, and
// unlike reisiftWebhookSocket's persistent webhook.site socket, this is
// plain one-shot request/response, so a webhook.site relay isn't needed:
// this app is the one initiating the connection, so there's no inbound-NAT
// problem to work around.
let webhookUrl = ''
let onStatus = () => {}

export function configureReisiftOutbound(config = {}) {
  webhookUrl = config.webhookUrl || ''
  onStatus = config.onStatus || (() => {})
}

// REISift's Zapier actions identify a property by its individual address
// fields (street/city/state/postal code), not by property.uuid — confirmed
// when the "Create/Update Property" action's own field list turned out to
// ask for exactly these, not a uuid lookup. propertyAddress (properties.js)
// is only the joined display string, so pull the components stored
// alongside it (see mapReisiftProperty) instead of re-splitting that string.
function reisiftAddressFields(property) {
  return {
    propertyStreet: property.addressStreet || '',
    propertyCity: property.addressCity || '',
    propertyState: property.addressState || '',
    propertyPostalCode: property.addressPostalCode || ''
  }
}

// REISift's inbound owner shape (see mapReisiftOwnerToContact) always has
// separate first_name/last_name — its Create/Update actions likely want the
// same, not the single combined `name` string this app stores locally, so
// split it back out. Best-effort: everything after the first word is
// "last name", which is wrong for multi-word first names, but there's no
// better signal to go on for a locally-typed contact.
function splitContactName(name) {
  const parts = (name || '').trim().split(/\s+/)
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') }
}

// Fire-and-forget from the caller's perspective (properties.js never awaits
// this) so a slow/failing Zap never delays or blocks a local save — same
// tolerance for eventual consistency the inbound sync already has.
export function notifyPhoneDispositioned({ property, contact, phone }) {
  if (!webhookUrl) return

  const body = {
    event: 'phone_dispositioned',
    reisiftPropertyUuid: property.reisiftUuid,
    ...reisiftAddressFields(property),
    propertyLabel: property.label,
    reisiftOwnerUuid: contact.reisiftUuid || '',
    contactName: contact.name,
    ...splitContactName(contact.name),
    relationship: contact.relationship,
    phoneNumber: phone.number,
    phoneLabel: phone.label,
    status: toReisiftPhoneStatus(phone.status),
    timestamp: new Date().toISOString()
  }

  return post(body)
}

async function post(body) {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    console.log('[reisift-outbound] disposition pushed')
    onStatus('→ REISift: disposition pushed')
    logZapFire({ at: Date.now(), success: true })
  } catch (err) {
    console.error('[reisift-outbound] disposition push failed:', err.message)
    onStatus(`→ REISift: disposition push failed (${err.message})`)
    logZapFire({ at: Date.now(), success: false, error: err.message })
  }
}

// Durable append-only log (JSON Lines, same convention as
// usageTracker.js's usage log) of every push attempt, so costReport.js can
// answer "how many Zaps fired over date range X" — nothing about this app's
// Zapier usage was persisted anywhere before this.
function zapLogPath() {
  return join(app.getPath('userData'), 'zapLog.jsonl')
}

function logZapFire(entry) {
  appendFile(zapLogPath(), JSON.stringify(entry) + '\n', 'utf-8').catch((err) => {
    console.error('[reisift-outbound] failed to append zap log:', err.message)
  })
}
