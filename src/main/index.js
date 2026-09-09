import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { config as loadEnv, parse as parseEnv } from 'dotenv'
import {
  loadStoredConfig,
  saveStoredConfig,
  applyConfigToEnv,
  missingRequiredKeys
} from './secureConfig.js'
import { listTranscripts, loadTranscript } from './trainingTranscripts.js'
import { getSuggestions } from './suggestions.js'
import { registerLiveCallHandlers } from './liveCall.js'
import {
  listProperties,
  searchProperties,
  saveProperty,
  updateProperty,
  deleteProperty
} from './properties.js'
import { parsePropertyText } from './parseProperty.js'
import { listVariants, getVariant, saveVariant, deleteVariant } from './scriptVariants.js'
import { parseScriptVariant } from './parseScriptVariant.js'
import { listReferences, saveReference, deleteReference } from './nepqReferences.js'
import { parseNepqReference } from './parseNepqReference.js'
import { analyzeCall } from './callAnalysis.js'
import { initUsageTracker, getUsageSnapshot } from './usageTracker.js'
import { startReisiftWebhookSocket } from './reisiftWebhookSocket.js'
import { configureReisiftOutbound } from './reisiftOutbound.js'

// Both src/main/index.js (dev) and out/main/index.js (built) sit exactly two
// directories below the project root, so this resolves correctly either way.
const appRootDir = join(import.meta.dirname, '../..')

loadEnv({ path: join(appRootDir, '.env'), quiet: true })

const isDev = !app.isPackaged

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers() {
  ipcMain.handle('training:list-transcripts', () => listTranscripts(appRootDir))
  ipcMain.handle('training:load-transcript', (_event, id) => loadTranscript(appRootDir, id))
  ipcMain.handle('suggestions:get', (_event, { transcriptText, callType, property, variantId }) =>
    getSuggestions(transcriptText, callType, property, variantId)
  )
  ipcMain.handle('scriptVariants:list', (_event, callType) => listVariants(callType))
  ipcMain.handle('scriptVariants:get', (_event, { callType, id }) => getVariant(callType, id))
  ipcMain.handle('scriptVariants:save', (_event, { callType, data }) => saveVariant(callType, data))
  ipcMain.handle('scriptVariants:delete', (_event, { callType, id }) => deleteVariant(callType, id))
  ipcMain.handle('scriptVariants:parse', (_event, rawText) => parseScriptVariant(rawText))
  ipcMain.handle('nepqReferences:list', () => listReferences())
  ipcMain.handle('nepqReferences:save', (_event, data) => saveReference(data))
  ipcMain.handle('nepqReferences:delete', (_event, id) => deleteReference(id))
  ipcMain.handle('nepqReferences:parse', (_event, { base64, filename }) => parseNepqReference(base64, filename))
  ipcMain.handle('callAnalysis:analyze', (_event, { transcriptText, callType }) =>
    analyzeCall(transcriptText, callType)
  )
  // Opens the recording's folder in Finder — "reveal" not "open the file",
  // so the rep lands on the whole call's files (transcript, merged audio,
  // meta.json), not just one of them.
  ipcMain.handle('recordings:reveal', (_event, dir) => {
    if (dir) shell.showItemInFolder(dir)
  })
  ipcMain.handle('properties:list', () => listProperties())
  ipcMain.handle('properties:search', (_event, query) => searchProperties(query))
  ipcMain.handle('properties:save', (_event, data) => saveProperty(data))
  ipcMain.handle('properties:update', (_event, { id, data }) => updateProperty(id, data))
  ipcMain.handle('properties:delete', (_event, id) => deleteProperty(id))
  ipcMain.handle('properties:parse', (_event, rawText) => parsePropertyText(rawText))
  // Hands off to the matching macOS URL handler — tel: (Phone app /
  // Continuity Dialer, the same app the whole live-call setup already
  // routes audio through), facetime-audio: (FaceTime.app, audio-only —
  // deliberately not facetime:, which opens as video), or sms:
  // (Messages.app). We're not placing the call/composing the text
  // ourselves, just triggering the OS app to. FaceTime is likely captured
  // by the same native-tap target as Phone calls (both are believed to run
  // through com.apple.avconferenced — see native/audiotap/main.swift's
  // header comment) but that's only confirmed for Phone calls so far.
  function digitsOnly(phoneNumber) {
    const digits = String(phoneNumber ?? '').replace(/[^\d+]/g, '')
    if (!digits) throw new Error('No phone number.')
    return digits
  }
  ipcMain.handle('dialer:call', (_event, phoneNumber) => {
    shell.openExternal(`tel:${digitsOnly(phoneNumber)}`)
  })
  ipcMain.handle('dialer:facetime', (_event, phoneNumber) => {
    shell.openExternal(`facetime-audio:${digitsOnly(phoneNumber)}`)
  })
  ipcMain.handle('dialer:text', (_event, phoneNumber) => {
    shell.openExternal(`sms:${digitsOnly(phoneNumber)}`)
  })
  ipcMain.handle('usage:get', () => getUsageSnapshot())
  registerLiveCallHandlers(() => mainWindow, appRootDir)

  // First-run Setup screen (src/renderer/src/SetupScreen.jsx) — gates the
  // main app on the two required keys being present, and lets a teammate
  // paste them in directly or import an existing .env file instead.
  ipcMain.handle('config:get-status', () => ({ missing: missingRequiredKeys() }))

  ipcMain.handle('config:save', (_event, values) => {
    const updates = {}
    if (values.anthropicApiKey) updates.ANTHROPIC_API_KEY = values.anthropicApiKey.trim()
    if (values.deepgramApiKey) updates.DEEPGRAM_API_KEY = values.deepgramApiKey.trim()
    if (values.reisiftWebhookUrl) updates.REISIFT_WEBHOOK_SITE_URL = values.reisiftWebhookUrl.trim()
    if (values.webhookSiteApiKey) updates.WEBHOOK_SITE_API_KEY = values.webhookSiteApiKey.trim()
    if (values.zapierStatusWebhookUrl) {
      updates.REISIFT_ZAPIER_STATUS_WEBHOOK_URL = values.zapierStatusWebhookUrl.trim()
    }
    if (values.zapierNewPhoneWebhookUrl) {
      updates.REISIFT_ZAPIER_NEW_PHONE_WEBHOOK_URL = values.zapierNewPhoneWebhookUrl.trim()
    }
    if (values.zapierNewContactWebhookUrl) {
      updates.REISIFT_ZAPIER_NEW_CONTACT_WEBHOOK_URL = values.zapierNewContactWebhookUrl.trim()
    }
    saveStoredConfig(updates)
    // Simplest way to guarantee every module that reads these (the
    // Anthropic/Deepgram clients, the REISift socket) picks up the new
    // values is a clean restart, rather than trying to invalidate half a
    // dozen already-constructed clients in place.
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('config:import-env-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import .env file',
      properties: ['openFile'],
      filters: [
        { name: 'Env file', extensions: ['env'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (canceled || !filePaths[0]) return null

    const parsed = parseEnv(readFileSync(filePaths[0]))
    return {
      anthropicApiKey: parsed.ANTHROPIC_API_KEY || '',
      deepgramApiKey: parsed.DEEPGRAM_API_KEY || '',
      reisiftWebhookUrl: parsed.REISIFT_WEBHOOK_SITE_URL || '',
      webhookSiteApiKey: parsed.WEBHOOK_SITE_API_KEY || '',
      zapierStatusWebhookUrl: parsed.REISIFT_ZAPIER_STATUS_WEBHOOK_URL || '',
      zapierNewPhoneWebhookUrl: parsed.REISIFT_ZAPIER_NEW_PHONE_WEBHOOK_URL || '',
      zapierNewContactWebhookUrl: parsed.REISIFT_ZAPIER_NEW_CONTACT_WEBHOOK_URL || ''
    }
  })
}

let reisiftWebhookSocket = null

app.whenReady().then(() => {
  // Packaged installs (see the README's "For your team" section) have no
  // .env file to load — the Setup screen collects keys on first run instead
  // and they're persisted encrypted via secureConfig.js, which relies on
  // Electron's safeStorage — unusable until this `ready` callback, so this
  // can't run at module load time like the dev .env load above. A dev .env
  // always takes priority over a stored value (applyConfigToEnv only fills
  // in gaps), so this doesn't change the normal `npm run dev` workflow.
  applyConfigToEnv(loadStoredConfig())

  initUsageTracker(() => mainWindow)
  registerIpcHandlers()
  createWindow()

  // Pushes 'properties:synced' so an open Property drawer (or a live call
  // already grounded in this property) picks up a webhook-driven update
  // without the rep manually refreshing, and 'reisift:status' for a small
  // connection indicator — see reisiftWebhookSocket.js.
  reisiftWebhookSocket = startReisiftWebhookSocket(process.env.REISIFT_WEBHOOK_SITE_URL, {
    onSynced: (result) => mainWindow?.webContents.send('properties:synced', result.property),
    onStatus: (message) => mainWindow?.webContents.send('reisift:status', message)
  })

  // Outbound direction — pushes dispositions/new numbers/new contacts back
  // to REISift via Zapier (see reisiftOutbound.js and properties.js's
  // detectOutboundChanges). Reuses the same 'reisift:status' line above for
  // push confirmations/failures rather than adding new UI.
  configureReisiftOutbound({
    statusWebhookUrl: process.env.REISIFT_ZAPIER_STATUS_WEBHOOK_URL,
    newPhoneWebhookUrl: process.env.REISIFT_ZAPIER_NEW_PHONE_WEBHOOK_URL,
    newContactWebhookUrl: process.env.REISIFT_ZAPIER_NEW_CONTACT_WEBHOOK_URL,
    onStatus: (message) => mainWindow?.webContents.send('reisift:status', message)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  reisiftWebhookSocket?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
