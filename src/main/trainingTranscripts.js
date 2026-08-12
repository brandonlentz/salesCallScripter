import { readdir, readFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'

// transcripts/ lives at the project root, is gitignored (real seller PII),
// and sits two directories above both src/main and out/main — see the
// symmetric layout note in main/index.js.
export function transcriptsRoot(appRootDir) {
  return join(appRootDir, 'transcripts')
}

const CATEGORIES = ['intro', 'offer']

// Lists available training transcripts as { id, label, category }, where id
// is "category/filename.txt" — safe to pass back from the renderer and
// re-join under transcriptsRoot without any other path traversal risk since
// only these two known category subfolders are ever read.
export async function listTranscripts(appRootDir) {
  const root = transcriptsRoot(appRootDir)
  const results = []

  for (const category of CATEGORIES) {
    let entries
    try {
      entries = await readdir(join(root, category))
    } catch {
      continue // category folder doesn't exist locally — fine, just skip it
    }

    for (const entry of entries) {
      if (extname(entry).toLowerCase() !== '.txt') continue
      results.push({
        id: `${category}/${entry}`,
        label: basename(entry, extname(entry)),
        category
      })
    }
  }

  return results.sort((a, b) => a.label.localeCompare(b.label))
}

export async function loadTranscript(appRootDir, id) {
  const [category, ...rest] = id.split('/')
  const filename = rest.join('/')
  if (!CATEGORIES.includes(category) || !filename || filename.includes('..')) {
    throw new Error(`Invalid transcript id: ${id}`)
  }

  const text = await readFile(join(transcriptsRoot(appRootDir), category, filename), 'utf-8')
  return text
}
