# Sales Call Scripter

An AI-powered sales teleprompter built on Jeremy Miner's NEPQ (Neuro-Emotional Persuasion Questioning) framework.

## What it does

Guides you in real-time through a sales call — listening to the conversation context and surfacing the right NEPQ questions and responses at each stage of the call.

## NEPQ Framework Stages

1. **Connection** — Build rapport, avoid triggering sales resistance
2. **Situation** — Understand their current state
3. **Problem Awareness** — Surface problems they may not fully see
4. **Solution Awareness** — Explore impact and urgency
5. **Consequence** — Deepen emotional engagement with the cost of inaction
6. **Qualifying** — Confirm fit and decision-making authority
7. **Transition to Presentation** — Set up the solution reveal
8. **Commitment** — Gain commitment without pressure

## Tech Stack

- **Electron** — macOS desktop shell
- **React + Vite** (via `electron-vite`) — renderer UI
- **BlackHole** — system audio capture (not yet wired up)
- **Web Speech API** — speech-to-text (not yet wired up)
- **Claude API** — real-time NEPQ suggestions

## Getting Started

### Prerequisites

- **macOS** (the app targets the desktop Electron shell + BlackHole for system audio)
- **Node.js 18+** and npm (comes with Node) — check with `node -v`
- An **Anthropic API key** — get one at https://console.anthropic.com/settings/keys
- [**BlackHole**](https://existential.audio/blackhole/) — only needed once system-audio capture
  is wired up; not required to run the current scaffold or Training Mode

### Install

```bash
git clone https://github.com/brandonlentz/salesCallScripter.git
cd salesCallScripter
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY
```

### Run in dev mode

```bash
npm run dev
```

This starts the Vite dev server and launches the Electron app pointed at it, with hot reload
on the renderer.

## Training Mode

Since there's no live-call audio pipeline yet, the app can replay any saved transcript from
`transcripts/intro/` or `transcripts/offer/` line by line to simulate a live call. This runs
through the exact same suggestion engine a real call will use — only the transcript source
differs — so it's the place to test and tune NEPQ stage detection and suggestion quality.

In the running app:

1. Pick a transcript from the **Training Mode** dropdown at the bottom of the window.
2. Use **Play** to auto-advance line by line (adjust speed with the slider), or **Step** to
   advance one line at a time for finer control. **Reset** starts the transcript over.
3. Click **Get Suggestions Now** at any point to send the transcript-so-far to Claude and see
   the detected NEPQ stage (highlighted in the tracker at the top) and suggested next
   questions/responses. Check **Auto-request suggestions** to have this happen automatically
   as the call plays — note this calls the Claude API on every update, so it costs more than
   requesting manually.

Requires `ANTHROPIC_API_KEY` to be set in `.env` (see Prerequisites above) — without it,
requesting suggestions shows a clear error instead of a suggestion.

### Build a production bundle

```bash
npm run build
```

Output goes to `out/`. Run the built app with:

```bash
npm run preview
```

### Local-only data

`transcripts/` and `data/` are gitignored — they're meant to hold real seller call
transcripts and related data locally for development/reference, and shouldn't be committed
since they contain customer PII.
