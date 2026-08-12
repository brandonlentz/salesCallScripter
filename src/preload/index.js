import { contextBridge } from 'electron'

// Bridge for renderer -> main process calls (e.g. Claude API requests,
// system-audio capture control) will be added here as those features land.
const api = {}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
