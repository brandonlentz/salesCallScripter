import io from 'socket.io-client'
import { upsertPropertyFromReisift } from './properties.js'

// Receives REISift's outbound webhook via webhook.site's real-time
// WebSocket push, instead of running our own internet-facing HTTP server.
// REISift is a hosted SaaS and this is a desktop app behind NAT, so it
// can't reach a locally-hosted receiver directly — a tunnel (ngrok,
// Cloudflare, Tailscale Funnel) is the usual fix, but the user didn't want
// to run tunnel software at all. webhook.site avoids that entirely: REISift
// posts to a public https://webhook.site/<token> URL (already reachable,
// no exposure needed), and this app subscribes to that token's events over
// a WebSocket — an outbound connection, exactly like the Deepgram
// connections in deepgram.js, so nothing has to be exposed on this machine.
//
// Requires socket.io-client's v2.x protocol specifically — webhook.site's
// server (ws.webhook.site) only speaks the old Engine.IO v3 wire protocol
// that v2 clients use; a v3/v4 client can't complete the handshake at all.
// Verified empirically against a real token: the event payload's actual
// shape is `{ request: { content, method, headers, ... }, ... }` — the
// public docs' own paraphrase of this (`data.content`) is wrong, so don't
// "fix" the `.request.content` path below back to match the docs.
//
// Caveat carried over from the free/anonymous webhook.site tier (the
// user's deliberate choice — see README): the URL stops accepting new
// requests after 100 total or 7 days, whichever comes first, and there's
// no way for us to detect that from here (webhook.site just silently stops
// forwarding — no error reaches this socket). When it dies, generate a new
// URL at webhook.site, update REISIFT_WEBHOOK_SITE_URL in .env, restart the
// app, and re-paste the new URL into REISift's webhook settings.
const WEBHOOK_SITE_SOCKET_URL = 'https://ws.webhook.site'

function extractTokenId(webhookSiteUrl) {
  // Accepts either the full page URL (https://webhook.site/<uuid>) or a
  // bare token — take whatever's after the last slash either way.
  return webhookSiteUrl.trim().replace(/\/+$/, '').split('/').pop()
}

// `onSynced(result)` fires after a successful create/update — wired to a
// 'properties:synced' IPC push in index.js, same as the old HTTP receiver.
// `onStatus(message)` fires on connect/disconnect/error for a small status
// indicator in the UI, since a silently-dead socket (or a silently-expired
// webhook.site URL) would otherwise fail invisibly.
export function startReisiftWebhookSocket(webhookSiteUrl, { onSynced, onStatus } = {}) {
  if (!webhookSiteUrl) {
    console.log('[reisift-socket] REISIFT_WEBHOOK_SITE_URL not set — REISift sync disabled.')
    return { stop() {} }
  }

  const tokenId = extractTokenId(webhookSiteUrl)
  const apiKey = process.env.WEBHOOK_SITE_API_KEY || ''

  const socket = io(WEBHOOK_SITE_SOCKET_URL, { transports: ['websocket', 'polling'] })

  socket.on('connect', () => {
    console.log(`[reisift-socket] connected, subscribing to token ${tokenId}`)
    socket.emit('subscribe', {
      channel: `private-token.${tokenId}`,
      // Only tokens tied to a logged-in webhook.site account need this —
      // an anonymous token (the common case here) ignores an empty header
      // set. See WEBHOOK_SITE_API_KEY in .env.example.
      auth: { headers: apiKey ? { 'Api-Key': apiKey } : {} }
    })
    onStatus?.('Connected to webhook.site')
  })

  socket.on('disconnect', (reason) => {
    console.log('[reisift-socket] disconnected:', reason)
    onStatus?.(`Disconnected from webhook.site (${reason}) — reconnecting…`)
  })

  socket.on('connect_error', (err) => {
    console.error('[reisift-socket] connect_error:', err.message)
    onStatus?.(`webhook.site connection error: ${err.message}`)
  })

  socket.on('request.created', async (_channel, data) => {
    const raw = data?.request?.content
    if (!raw) return

    let payload
    try {
      payload = JSON.parse(raw)
    } catch (err) {
      console.error('[reisift-socket] delivery was not valid JSON:', err.message)
      return
    }

    if (!payload?.property) {
      console.log(`[reisift-socket] ignoring event with no property payload: ${payload?.event_type}`)
      return
    }

    try {
      const result = await upsertPropertyFromReisift(payload.property)
      console.log(
        `[reisift-socket] ${result.created ? 'created' : 'updated'} property "${result.property.label}" (reisift uuid ${payload.property.uuid})`
      )
      onSynced?.(result)
    } catch (err) {
      console.error('[reisift-socket] sync failed:', err)
    }
  })

  return {
    stop() {
      socket.disconnect()
    }
  }
}
