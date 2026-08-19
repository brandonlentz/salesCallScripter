import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Local, file-based store for NEPQ framework reference material — distilled
// text extracted from uploaded PDFs (Jeremy Miner NEPQ training documents,
// or similar), kept separate from the call scripts in scriptVariants.js.
// Scripts are word-for-word ground truth for a specific call type;
// references are general methodology (question patterns, principles,
// objection-handling approach) that applies across all call types — see
// nepqPrompt.js for how they're combined into the suggestion engine's
// system prompt.
//
// Stored entirely outside the repo (Electron's userData dir) and never
// committed — this is licensed/proprietary training material the user
// uploads for their own private use, not something to check into git.
function storePath() {
  return join(app.getPath('userData'), 'nepqReferences.json')
}

async function readStore() {
  try {
    const raw = await fs.readFile(storePath(), 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return []
  }
}

async function writeStore(references) {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(storePath(), JSON.stringify(references, null, 2))
}

export async function listReferences() {
  const references = await readStore()
  return references.sort((a, b) => a.uploadedAt - b.uploadedAt)
}

// Returns just the extracted content of every saved reference, in upload
// order — what nepqPrompt.js actually needs to ground the system prompt.
export async function getAllReferenceContent() {
  const references = await listReferences()
  return references.map((r) => r.content)
}

export async function saveReference({ label, filename, content }) {
  if (!label?.trim()) {
    throw new Error('Give this reference a name (e.g. "NEPQ Black Book").')
  }
  if (!content?.trim()) {
    throw new Error('No extracted content to save — parse a PDF first.')
  }
  const references = await readStore()
  const reference = {
    id: randomUUID(),
    label: label.trim(),
    filename: filename ?? null,
    content: content.trim(),
    uploadedAt: Date.now()
  }
  references.push(reference)
  await writeStore(references)
  return reference
}

export async function deleteReference(id) {
  const references = await readStore()
  await writeStore(references.filter((r) => r.id !== id))
}
