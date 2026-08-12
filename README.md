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
- **Claude API** — real-time NEPQ suggestions (not yet wired up)

## Getting Started

### Prerequisites

- **macOS** (the app targets the desktop Electron shell + BlackHole for system audio)
- **Node.js 18+** and npm (comes with Node) — check with `node -v`
- [**BlackHole**](https://existential.audio/blackhole/) — only needed once system-audio capture
  is wired up; not required to run the current scaffold

### Install

```bash
git clone https://github.com/brandonlentz/salesCallScripter.git
cd salesCallScripter
npm install
```

### Run in dev mode

```bash
npm run dev
```

This starts the Vite dev server and launches the Electron app pointed at it, with hot reload
on the renderer. Currently the window shows a stage tracker for the 8 NEPQ stages and
placeholder panels for the live transcript and suggestion feed — audio capture, STT, and
Claude-powered suggestions haven't been wired up yet.

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
