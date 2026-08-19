import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
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
  // Hands off to macOS's tel: handler — the Phone app / Continuity Dialer,
  // the same app this whole live-call setup already routes audio through.
  // We're not placing the call ourselves, just triggering the OS to.
  ipcMain.handle('dialer:call', (_event, phoneNumber) => {
    const digits = String(phoneNumber ?? '').replace(/[^\d+]/g, '')
    if (!digits) throw new Error('No phone number to call.')
    shell.openExternal(`tel:${digits}`)
  })
  registerLiveCallHandlers(() => mainWindow, appRootDir)
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
