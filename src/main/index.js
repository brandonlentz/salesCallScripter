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
    // Keep the teleprompter on top of a video call / browser during a live call.
    alwaysOnTop: true,
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
  ipcMain.handle('suggestions:get', (_event, { transcriptText, callType, property }) =>
    getSuggestions(transcriptText, callType, property)
  )
  ipcMain.handle('properties:list', () => listProperties())
  ipcMain.handle('properties:search', (_event, query) => searchProperties(query))
  ipcMain.handle('properties:save', (_event, data) => saveProperty(data))
  ipcMain.handle('properties:update', (_event, { id, data }) => updateProperty(id, data))
  ipcMain.handle('properties:delete', (_event, id) => deleteProperty(id))
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
