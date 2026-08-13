import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// recordings/ lives at the project root and is gitignored (real seller PII
// plus call audio) — same convention as transcripts/ and data/, see the
// "Local-only data" section in the README.
function recordingsRoot(appRootDir) {
  return join(appRootDir, 'recordings')
}

// Property labels/addresses become part of a folder name — keep it to
// filesystem-safe characters.
function sanitizeForPath(text) {
  return text
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// Starts recording a live call to disk: one raw audio file per channel
// (each channel's MediaRecorder chunks are appended in order, which
// reassembles into a valid, playable .webm — same technique already used
// to stream these same chunks to Deepgram), a transcript.txt, and a
// meta.json with call type, matched property, and timing. Call
// recording.finish() when the call ends.
export async function startRecording(appRootDir, { callType, channels, property }) {
  const startedAt = new Date()
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
  const label = property?.label ? `-${sanitizeForPath(property.label)}` : ''
  const dir = join(recordingsRoot(appRootDir), callType, `${stamp}${label}`)
  await mkdir(dir, { recursive: true })

  const streams = new Map(channels.map((channel) => [channel, createWriteStream(join(dir, `audio-${channel}.webm`))]))

  return {
    dir,
    appendChunk(channel, buffer) {
      streams.get(channel)?.write(buffer)
    },
    async finish({ transcriptText } = {}) {
      await Promise.all(
        Array.from(streams.values()).map((stream) => new Promise((resolve) => stream.end(resolve)))
      )
      if (transcriptText) {
        await writeFile(join(dir, 'transcript.txt'), transcriptText, 'utf-8')
      }
      await writeFile(
        join(dir, 'meta.json'),
        JSON.stringify(
          {
            callType,
            channels,
            property: property ?? null,
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf-8'
      )
      return dir
    }
  }
}
