import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SetupScreen from './SetupScreen'
import './index.css'

// Gates the real app behind first-run Setup (SetupScreen.jsx) until both
// required keys are present — see config:get-status in src/main/index.js.
function Root() {
  const [missing, setMissing] = useState(null) // null = still checking

  useEffect(() => {
    window.api.config.getStatus().then((status) => setMissing(status.missing))
  }, [])

  if (missing === null) return null
  return missing.length > 0 ? <SetupScreen /> : <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
