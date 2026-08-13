import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CALL_SCRIPTS, CALL_TYPES } from '../shared/callScripts.js'

// Local, file-based store for alternate versions of a call type's script —
// lightweight split-testing: keep a few named variants around (a different
// opening, a reworded objection response), pick which one is "live" for a
// given call or Training Mode replay, and judge results by ear/outcome
// yourself. No in-app win/loss tracking — deliberately out of scope for now.
//
// Every call type always has an 'original' variant, seeded on first read
// from the hardcoded CALL_SCRIPTS in shared/callScripts.js — that's the
// ground-truth script ported from call-tracker, and it can't be deleted, so
// there's always a safe fallback.
//
// Stored entirely outside the repo (Electron's userData dir) and never
// committed. Unlike properties.js's data, script variants aren't PII, but
// keeping them here too means adding/editing one never needs a rebuild.
function storePath() {
  return join(app.getPath('userData'), 'scriptVariants.json')
}

function seedStore() {
  const store = {}
  for (const callType of CALL_TYPES) {
    store[callType] = [
      {
        id: 'original',
        label: 'Original',
        sections: structuredClone(CALL_SCRIPTS[callType]),
        builtin: true,
        updatedAt: Date.now()
      }
    ]
  }
  return store
}

async function readStore() {
  try {
    const raw = await fs.readFile(storePath(), 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    const seeded = seedStore()
    await writeStore(seeded)
    return seeded
  }
}

async function writeStore(store) {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(storePath(), JSON.stringify(store, null, 2))
}

function assertCallType(callType) {
  if (!CALL_TYPES.includes(callType)) {
    throw new Error(`Unknown call type: ${callType}`)
  }
}

export async function listVariants(callType) {
  assertCallType(callType)
  const store = await readStore()
  return (store[callType] ?? []).sort((a, b) => a.updatedAt - b.updatedAt)
}

export async function getVariant(callType, id) {
  const variants = await listVariants(callType)
  const variant = variants.find((v) => v.id === id)
  if (!variant) {
    throw new Error(`Script variant not found: ${callType}/${id}`)
  }
  return variant
}

export async function saveVariant(callType, data) {
  assertCallType(callType)
  if (!data.label?.trim()) {
    throw new Error('Variant needs a label (e.g. "Softer opening").')
  }
  if (!Array.isArray(data.sections) || data.sections.length === 0) {
    throw new Error('Variant needs at least one script section.')
  }
  const store = await readStore()
  const variants = store[callType] ?? []
  const variant = {
    id: randomUUID(),
    label: data.label,
    sections: data.sections,
    builtin: false,
    updatedAt: Date.now()
  }
  store[callType] = [...variants, variant]
  await writeStore(store)
  return variant
}

export async function deleteVariant(callType, id) {
  assertCallType(callType)
  const store = await readStore()
  const variants = store[callType] ?? []
  const target = variants.find((v) => v.id === id)
  if (target?.builtin) {
    throw new Error('The "Original" variant can\'t be deleted.')
  }
  store[callType] = variants.filter((v) => v.id !== id)
  await writeStore(store)
}
