// Outbound counterpart to reisiftWebhookSocket.js — that file receives
// REISift's data; this one sends this app's data back out. REISift doesn't
// publish a general inbound REST API, so the only documented way to push
// data *into* REISift is through its Zapier integration, which (per
// REISift's own docs) works exclusively as a Zapier Action — it receives
// data, it doesn't emit triggers. The setup on the REISift/Zapier side is:
// a Zap per event below, each starting with "Webhooks by Zapier" → "Catch
// Hook" (that step's URL is what goes in the three env vars this module
// reads), followed by the matching REISift action — see the README's
// "Pushing dispositions and new contacts back to REISift" section.
//
// Each event here only ever fires for a property REISift already knows
// about (has a reisiftUuid from a prior inbound sync — see properties.js's
// detectOutboundChanges) — there's no REISift record to attach anything to
// otherwise.
//
// Sent in real time, one item per push — no local batching/scheduling.
// Hourly batching, if wanted, is handled Zapier-side (e.g. Digest by
// Zapier collecting pushes and releasing them on a schedule) rather than
// this app queuing anything itself.
//
// Uses Electron main process's built-in `fetch` — no new dependency, and
// unlike reisiftWebhookSocket's persistent webhook.site socket, this is
// plain one-shot request/response, so a webhook.site relay isn't needed:
// this app is the one initiating the connection, so there's no inbound-NAT
// problem to work around.
let statusWebhookUrl = ''
let newPhoneWebhookUrl = ''
let newContactWebhookUrl = ''
let onStatus = () => {}

export function configureReisiftOutbound(config = {}) {
  statusWebhookUrl = config.statusWebhookUrl || ''
  newPhoneWebhookUrl = config.newPhoneWebhookUrl || ''
  newContactWebhookUrl = config.newContactWebhookUrl || ''
  onStatus = config.onStatus || (() => {})
}

// Fire-and-forget from the caller's perspective (properties.js never awaits
// these) so a slow/failing Zap never delays or blocks a local save — same
// tolerance for eventual consistency the inbound sync already has.
async function post(webhookUrl, body, label) {
  if (!webhookUrl) return

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    console.log(`[reisift-outbound] ${label} pushed`)
    onStatus(`→ REISift: ${label} pushed`)
  } catch (err) {
    console.error(`[reisift-outbound] ${label} push failed:`, err.message)
    onStatus(`→ REISift: ${label} push failed (${err.message})`)
  }
}

// REISift's "Add Phone Status to Phones" Zapier action exposes Phone's
// Status as a fixed enum, not free text — confirmed from the actual field
// picker: UNKNOWN, CORRECT, CORRECT_DNC, WRONG, WRONG_DNC, DEAD, NO_ANSWER,
// DNC. This app's own status values (phoneStatuses.js's PHONE_STATUSES)
// are lowercase/hyphenated for its own UI, so translate rather than assume
// they line up — REISift's dropdown doesn't accept 'no-answer' as-is.
// REISift's CORRECT_DNC/WRONG_DNC (correctness + DNC combined) have no
// local equivalent — this app treats DNC as its own exclusive status — so
// there's nothing to map to them.
const REISIFT_STATUS_BY_LOCAL_STATUS = {
  '': 'UNKNOWN',
  correct: 'CORRECT',
  wrong: 'WRONG',
  'no-answer': 'NO_ANSWER',
  dnc: 'DNC',
  dead: 'DEAD'
}

function toReisiftPhoneStatus(localStatus) {
  return REISIFT_STATUS_BY_LOCAL_STATUS[localStatus] ?? 'UNKNOWN'
}

export function notifyPhoneStatusChanged({ property, contact, phone }) {
  return post(
    statusWebhookUrl,
    {
      event: 'phone_status_updated',
      reisiftPropertyUuid: property.reisiftUuid,
      reisiftOwnerUuid: contact.reisiftUuid,
      contactName: contact.name,
      propertyLabel: property.label,
      phoneNumber: phone.number,
      phoneLabel: phone.label,
      status: toReisiftPhoneStatus(phone.status),
      timestamp: new Date().toISOString()
    },
    'phone status'
  )
}

export function notifyNewPhoneNumber({ property, contact, phone }) {
  return post(
    newPhoneWebhookUrl,
    {
      event: 'phone_number_added',
      reisiftPropertyUuid: property.reisiftUuid,
      reisiftOwnerUuid: contact.reisiftUuid,
      contactName: contact.name,
      propertyLabel: property.label,
      phoneNumber: phone.number,
      phoneLabel: phone.label,
      timestamp: new Date().toISOString()
    },
    'new phone number'
  )
}

export function notifyNewContact({ property, contact }) {
  return post(
    newContactWebhookUrl,
    {
      event: 'contact_added',
      reisiftPropertyUuid: property.reisiftUuid,
      contactName: contact.name,
      relationship: contact.relationship,
      propertyLabel: property.label,
      phones: (contact.phones ?? []).map((p) => ({ number: p.number, label: p.label })),
      timestamp: new Date().toISOString()
    },
    'new contact'
  )
}
