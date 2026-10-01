import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Where teammates' API keys/webhook URL live once the app is packaged and
// running from /Applications — there's no writable .env next to an
// installed bundle (Contents/Resources is read-only in practice), so
// first-run Setup (see SetupScreen.jsx) collects them here instead.
// Encrypted at rest via safeStorage (backed by the macOS Keychain) so a
// copy of userData isn't a plaintext credential dump.
const CONFIG_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_WORKSPACE_ID',
  'DEEPGRAM_API_KEY',
  'REISIFT_WEBHOOK_SITE_URL',
  'WEBHOOK_SITE_API_KEY',
  // Outbound Zapier Catch Hook URL — see reisiftOutbound.js and the
  // README's "Pushing dispositions to REISift".
  'REISIFT_ZAPIER_WEBHOOK_URL'
]

const REQUIRED_KEYS = ['ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY']

function configPath() {
  return join(app.getPath('userData'), 'config.json')
}

export function loadStoredConfig() {
  const path = configPath()
  if (!existsSync(path)) return {}

  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }

  const result = {}
  for (const key of CONFIG_KEYS) {
    const encoded = raw[key]
    if (!encoded) continue
    try {
      result[key] = safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      // Keychain-backed encryption key unavailable (e.g. config.json got
      // copied to another machine) — treat as unset rather than crashing.
    }
  }
  return result
}

// Merges `config` into process.env for any key not already set — a dev
// .env file (see index.js) always wins, so the existing local-dev workflow
// is unchanged.
export function applyConfigToEnv(config) {
  for (const key of CONFIG_KEYS) {
    if (!process.env[key] && config[key]) process.env[key] = config[key]
  }
}

// Persists `updates` (a subset of CONFIG_KEYS, e.g. from the Setup screen
// or an imported .env file) merged over whatever's already stored.
export function saveStoredConfig(updates) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('This Mac has no Keychain-backed encryption available — cannot save keys securely.')
  }

  const merged = { ...loadStoredConfig(), ...updates }
  const raw = {}
  for (const key of CONFIG_KEYS) {
    if (merged[key]) raw[key] = safeStorage.encryptString(merged[key]).toString('base64')
  }

  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(raw, null, 2), { mode: 0o600 })
}

export function missingRequiredKeys() {
  return REQUIRED_KEYS.filter((key) => !process.env[key])
}
