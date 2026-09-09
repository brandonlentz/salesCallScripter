import { useState } from 'react'

// Shown instead of <App> on first run (see main.jsx) until both required
// keys are present. Saving relaunches the app (src/main/index.js's
// config:save handler) so it never appears again after that.
export default function SetupScreen() {
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [deepgramApiKey, setDeepgramApiKey] = useState('')
  const [reisiftWebhookUrl, setReisiftWebhookUrl] = useState('')
  const [webhookSiteApiKey, setWebhookSiteApiKey] = useState('')
  const [zapierStatusWebhookUrl, setZapierStatusWebhookUrl] = useState('')
  const [zapierNewPhoneWebhookUrl, setZapierNewPhoneWebhookUrl] = useState('')
  const [zapierNewContactWebhookUrl, setZapierNewContactWebhookUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleImport() {
    setError('')
    const parsed = await window.api.config.importEnvFile()
    if (!parsed) return
    if (parsed.anthropicApiKey) setAnthropicApiKey(parsed.anthropicApiKey)
    if (parsed.deepgramApiKey) setDeepgramApiKey(parsed.deepgramApiKey)
    if (parsed.reisiftWebhookUrl) setReisiftWebhookUrl(parsed.reisiftWebhookUrl)
    if (parsed.webhookSiteApiKey) setWebhookSiteApiKey(parsed.webhookSiteApiKey)
    if (parsed.zapierStatusWebhookUrl) setZapierStatusWebhookUrl(parsed.zapierStatusWebhookUrl)
    if (parsed.zapierNewPhoneWebhookUrl) setZapierNewPhoneWebhookUrl(parsed.zapierNewPhoneWebhookUrl)
    if (parsed.zapierNewContactWebhookUrl) setZapierNewContactWebhookUrl(parsed.zapierNewContactWebhookUrl)
  }

  async function handleSave() {
    if (!anthropicApiKey.trim() || !deepgramApiKey.trim()) {
      setError('Anthropic and Deepgram keys are both required.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await window.api.config.save({
        anthropicApiKey,
        deepgramApiKey,
        reisiftWebhookUrl,
        webhookSiteApiKey,
        zapierStatusWebhookUrl,
        zapierNewPhoneWebhookUrl,
        zapierNewContactWebhookUrl
      })
      // App relaunches itself right after this resolves — nothing more to do.
    } catch (err) {
      setSaving(false)
      setError(err?.message || 'Failed to save.')
    }
  }

  return (
    <div className="setup">
      <div className="setup__card">
        <h1>Sales Call Scripter — Setup</h1>
        <p className="setup__intro">
          One-time setup. Keys are encrypted and stored on this Mac only — you won't see this
          screen again after saving.
        </p>

        <button type="button" className="setup__import" onClick={handleImport}>
          Import from a .env file…
        </button>

        <label className="setup__field">
          <span>
            Anthropic API key <em>(required)</em>
          </span>
          <input
            type="password"
            value={anthropicApiKey}
            onChange={(e) => setAnthropicApiKey(e.target.value)}
            placeholder="sk-ant-..."
            autoFocus
          />
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            Get a key
          </a>
        </label>

        <label className="setup__field">
          <span>
            Deepgram API key <em>(required)</em>
          </span>
          <input
            type="password"
            value={deepgramApiKey}
            onChange={(e) => setDeepgramApiKey(e.target.value)}
            placeholder="..."
          />
          <a href="https://console.deepgram.com/" target="_blank" rel="noreferrer">
            Get a key
          </a>
        </label>

        <p className="setup__section-label">REISift sync (optional — can be added later)</p>

        <label className="setup__field">
          <span>REISift webhook URL</span>
          <input
            type="text"
            value={reisiftWebhookUrl}
            onChange={(e) => setReisiftWebhookUrl(e.target.value)}
            placeholder="https://webhook.site/..."
          />
        </label>

        <label className="setup__field">
          <span>
            webhook.site API key <em>(only for a logged-in webhook.site account)</em>
          </span>
          <input
            type="password"
            value={webhookSiteApiKey}
            onChange={(e) => setWebhookSiteApiKey(e.target.value)}
          />
        </label>

        <label className="setup__field">
          <span>
            Zapier webhook — phone status <em>(pushes call dispositions to REISift)</em>
          </span>
          <input
            type="text"
            value={zapierStatusWebhookUrl}
            onChange={(e) => setZapierStatusWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/hooks/catch/..."
          />
        </label>

        <label className="setup__field">
          <span>
            Zapier webhook — new phone number <em>(pushes new numbers on known contacts)</em>
          </span>
          <input
            type="text"
            value={zapierNewPhoneWebhookUrl}
            onChange={(e) => setZapierNewPhoneWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/hooks/catch/..."
          />
        </label>

        <label className="setup__field">
          <span>
            Zapier webhook — new contact <em>(pushes brand-new contacts)</em>
          </span>
          <input
            type="text"
            value={zapierNewContactWebhookUrl}
            onChange={(e) => setZapierNewContactWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/hooks/catch/..."
          />
        </label>

        {error && <p className="setup__error">{error}</p>}

        <button type="button" className="setup__save" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Launch'}
        </button>
      </div>
    </div>
  )
}
