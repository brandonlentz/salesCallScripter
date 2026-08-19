import { spawn } from 'node:child_process'
import { join } from 'node:path'

// Spawns the native `audiotap` helper (native/audiotap — see its README/comments
// for how it captures audio) and streams its stdout — raw 16-bit signed
// little-endian PCM, mono, 16kHz — to the caller. This is the macOS-only
// replacement for BlackHole-based caller-audio capture: it taps the Phone app's
// audio directly via Core Audio's process-tap API instead of requiring system
// Output to be routed through a virtual device.
//
// Mirrors the one existing precedent in this codebase for shelling out to a
// native binary — recording.js's `spawn('ffmpeg', …)` — including its
// ENOENT → friendly-error handling.
export const AUDIO_TAP_SAMPLE_RATE = 16000

function helperPath(appRootDir) {
  return join(appRootDir, 'native', 'audiotap', 'build', 'audiotap')
}

// onData(buffer): raw PCM chunks as they arrive.
// onStatus(message): helper's stderr lines (progress/diagnostics, not fatal).
// onError(message): spawn failure or repeated crash — surface this visibly,
// same lesson as the BlackHole monitor-relay fix (no silent console-only
// failures during a live call).
//
// processName/bundleId: which process to tap. Leave both unset for the
// helper's own default (--bundle-id com.apple.avconferenced — the daemon
// that actually renders Phone/FaceTime call audio; the visible "Phone" app
// itself only plays UI sounds like the connect tone, confirmed via the
// helper's --list-processes diagnostic during a real call). Only pass one
// of these to override — see native/audiotap/main.swift's header comment.
// Returns { stop() }.
export function startAudioTapCapture(appRootDir, { processName, bundleId, onData, onStatus, onError }) {
  const binary = helperPath(appRootDir)
  let stopped = false
  let child = null
  let restartTimer = null

  function spawnHelper() {
    const targetArgs = processName
      ? ['--process-name', processName]
      : bundleId
        ? ['--bundle-id', bundleId]
        : []
    child = spawn(binary, [...targetArgs, '--sample-rate', String(AUDIO_TAP_SAMPLE_RATE)])

    child.stdout.on('data', (chunk) => onData?.(chunk))

    let stderrBuf = ''
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString()
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() ?? ''
      for (const line of lines) {
        if (line) onStatus?.(line)
      }
    })

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        onError?.(
          'Native audio tap helper is not built. Run "npm run build:audiotap" (requires Xcode Command Line Tools), then try again.'
        )
      } else {
        onError?.(`Native audio tap helper failed to start: ${err.message}`)
      }
    })

    child.on('exit', (code, signal) => {
      child = null
      if (stopped) return
      // Crashed unexpectedly (not our own SIGTERM from stop()) — respawn
      // with a short backoff rather than silently going dark on this
      // channel for the rest of the call.
      onError?.(`Native audio tap helper exited unexpectedly (code ${code}, signal ${signal}). Restarting.`)
      restartTimer = setTimeout(spawnHelper, 1000)
    })
  }

  spawnHelper()

  return {
    stop() {
      stopped = true
      clearTimeout(restartTimer)
      child?.kill('SIGTERM')
      child = null
    }
  }
}
