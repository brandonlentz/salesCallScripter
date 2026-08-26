import { createServer } from 'node:http'
import { upsertPropertyFromReisift } from './properties.js'

// Local HTTP listener for REISift's outbound webhooks (REISift ->
// Settings -> Integrations -> Webhooks -> a sequence's "Webhook" action).
// REISift is a hosted SaaS and this is a desktop app behind NAT, so it
// can't reach this port directly — see the README's Property Context
// section for exposing it (this project uses Tailscale Funnel, for its
// stable hostname across restarts: `tailscale funnel <port>`).
//
// No signature verification (yet): REISift signs deliveries
// (x-sift-webhook-signature / x-sift-webhook-timestamp / x-sift-webhook-key-id)
// but doesn't publish the HMAC scheme in their docs, and this endpoint sits
// behind an unguessable tunnel hostname in the meantime — accepted
// tradeoff for now. Tighten this if REISift's dashboard ever surfaces a
// signing secret or documents the scheme.
const DEFAULT_PORT = 4790

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      // A malformed/abusive request shouldn't be able to hold a connection
      // open indefinitely growing a string — real payloads here are a few
      // KB (see the sample in the README/commit history).
      if (data.length > 5_000_000) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

// `onSynced(result)` fires after a successful create/update — App.jsx
// wires this to a 'properties:synced' IPC push so an open Property drawer
// (or a live call already grounded in this property) picks up the change
// without waiting for the rep to manually refresh.
export function startReisiftWebhookServer(onSynced) {
  const port = Number(process.env.REISIFT_WEBHOOK_PORT) || DEFAULT_PORT

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }

    let payload
    try {
      const raw = await readBody(req)
      payload = JSON.parse(raw)
    } catch (err) {
      console.error('[reisift-webhook] bad request:', err.message)
      res.writeHead(400).end()
      return
    }

    // Ack immediately once parsed — REISift retries non-2xx responses, and
    // an event type with no property (any sequence action we don't care
    // about) isn't a failure, just nothing to sync.
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }))

    if (!payload?.property) {
      console.log(`[reisift-webhook] ignoring event with no property payload: ${payload?.event_type}`)
      return
    }

    try {
      const result = await upsertPropertyFromReisift(payload.property)
      console.log(
        `[reisift-webhook] ${result.created ? 'created' : 'updated'} property "${result.property.label}" (reisift uuid ${payload.property.uuid})`
      )
      onSynced?.(result)
    } catch (err) {
      // The HTTP response is already sent — this can only be logged, not
      // surfaced as a failed delivery to REISift, but a bad sync shouldn't
      // crash the app either way.
      console.error('[reisift-webhook] sync failed:', err)
    }
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`[reisift-webhook] listening on http://127.0.0.1:${port}`)
  })
  server.on('error', (err) => {
    console.error('[reisift-webhook] server error:', err.message)
  })

  return {
    stop() {
      server.close()
    }
  }
}
