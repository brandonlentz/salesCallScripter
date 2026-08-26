import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

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

// Every channel is recorded as `audio-<channel>.<ext>`. Almost every source
// is a browser MediaRecorder stream, whose chunks concatenate into a valid
// .webm with no extra work — that's the default. The native audiotap helper
// (see audioTap.js) instead emits headerless raw PCM, which needs its own
// extension and explicit ffmpeg input flags (`-f s16le -ar ... -ac ...`) so
// ffmpeg knows how to read it — `channelFormats` carries that per channel.
function extFor(channel, channelFormats) {
  return channelFormats?.[channel]?.ext ?? 'webm'
}
function ffmpegInputArgsFor(channel, channelFormats) {
  return channelFormats?.[channel]?.ffmpegArgs ?? []
}

// Dual-stream calls record the rep and prospect as separate mono files —
// good for exact speaker labels, bad for just listening back to the call.
// Merge them into one stereo file (rep on the left channel, prospect on the
// right — reviewable in any player, still spatially separated) via ffmpeg.
// Requires ffmpeg on PATH (brew install ffmpeg); this is best-effort and
// never blocks the per-channel recording, which already succeeded by the
// time this runs.
//
// This is NOT a plain amerge/join of the two mono tracks — both of those
// filters silently truncate to the length of the SHORTER input by default,
// which would cut off whoever kept talking after the other side went quiet
// (verified against real audio while building this). Instead, each mono
// track is panned hard to its own stereo channel (silence on the other)
// and combined with amix's duration=longest, which pads the shorter track
// with silence instead of truncating the longer one. normalize=0 because
// amix's default loudness normalization is for overlapping content on the
// same channel — there isn't any here, each channel has exactly one source.
//
// `channelStartedAt` (wall-clock ms per channel, set on each channel's
// first appendChunk() — see startRecording below) fixes a real skew: the
// 'rep' MediaRecorder and the native audiotap helper each start producing
// audio independently, on their own schedule (mic-permission prompts,
// getUserMedia latency, how long the tap takes to attach), not in lockstep.
// Both files still start writing at their own byte offset 0, so without
// correction ffmpeg lines those up as if they began at the same instant —
// whichever channel actually started later ends up shifted earlier than it
// should be, which sounds like the two sides talking over each other even
// when they didn't. Padding the later-starting channel with silence
// (adelay, ms) equal to the gap between the two start times re-aligns them
// to a shared t=0 before the pan/mix above ever sees them.
function mergeChannels(dir, channelFormats, channelStartedAt = {}) {
  const repPath = join(dir, `audio-rep.${extFor('rep', channelFormats)}`)
  const prospectPath = join(dir, `audio-prospect.${extFor('prospect', channelFormats)}`)
  const outputFile = 'audio-merged.mp3'

  const repStart = channelStartedAt.rep
  const prospectStart = channelStartedAt.prospect
  // Only correctable if we actually saw a first chunk on both sides —
  // otherwise (e.g. one channel never received audio) fall back to no
  // delay, the old behavior, rather than guessing.
  const earliest = repStart != null && prospectStart != null ? Math.min(repStart, prospectStart) : null
  const repDelayMs = earliest != null ? repStart - earliest : 0
  const prospectDelayMs = earliest != null ? prospectStart - earliest : 0

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      ...ffmpegInputArgsFor('rep', channelFormats),
      '-i',
      repPath,
      ...ffmpegInputArgsFor('prospect', channelFormats),
      '-i',
      prospectPath,
      '-filter_complex',
      `[0:a]adelay=${repDelayMs}:all=1,aresample=async=1,pan=stereo|c0=c0|c1=0*c0[a0];` +
        `[1:a]adelay=${prospectDelayMs}:all=1,aresample=async=1,pan=stereo|c0=0*c0|c1=c0[a1];` +
        '[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]',
      '-map',
      '[aout]',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '4',
      join(dir, outputFile)
    ])

    let stderr = ''
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    ffmpeg.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('ffmpeg is not installed — run "brew install ffmpeg" to get merged-call audio.'))
      } else {
        reject(err)
      }
    })
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputFile)
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`))
    })
  })
}

// Starts recording a live call to disk: one raw audio file per channel
// (each channel's MediaRecorder chunks are appended in order, which
// reassembles into a valid, playable .webm — same technique already used
// to stream these same chunks to Deepgram), a transcript.txt, and a
// meta.json with call type, matched property, and timing. Call
// recording.finish() when the call ends.
export async function startRecording(appRootDir, { callType, channels, property, channelFormats }) {
  const startedAt = new Date()
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
  const label = property?.label ? `-${sanitizeForPath(property.label)}` : ''
  const dir = join(recordingsRoot(appRootDir), callType, `${stamp}${label}`)
  await mkdir(dir, { recursive: true })

  const streams = new Map(
    channels.map((channel) => [
      channel,
      createWriteStream(join(dir, `audio-${channel}.${extFor(channel, channelFormats)}`))
    ])
  )
  // Wall-clock time of each channel's first appendChunk() — see
  // mergeChannels' comment above for why this matters for alignment.
  const channelStartedAt = {}

  return {
    dir,
    appendChunk(channel, buffer) {
      if (!(channel in channelStartedAt)) channelStartedAt[channel] = Date.now()
      streams.get(channel)?.write(buffer)
    },
    async finish({ transcriptText } = {}) {
      await Promise.all(
        Array.from(streams.values()).map((stream) => new Promise((resolve) => stream.end(resolve)))
      )

      let mergedAudioFile = null
      let mergeError = null
      if (channels.includes('rep') && channels.includes('prospect')) {
        try {
          mergedAudioFile = await mergeChannels(dir, channelFormats, channelStartedAt)
        } catch (err) {
          mergeError = err.message
        }
      }

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
            endedAt: new Date().toISOString(),
            mergedAudioFile
          },
          null,
          2
        ),
        'utf-8'
      )
      return { dir, mergeError }
    }
  }
}
