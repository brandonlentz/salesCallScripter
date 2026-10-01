import Anthropic from '@anthropic-ai/sdk'

// Org-level API keys (as opposed to keys created from inside a specific
// workspace in the console) aren't scoped to a workspace, so Anthropic
// rejects requests from them with a 401 unless every request carries an
// anthropic-workspace-id header. ANTHROPIC_WORKSPACE_ID is optional and only
// needed for that case — leave it unset when using a workspace-scoped key.
export function createAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
      ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
      : undefined
  })
}
