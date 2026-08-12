# Sales Call Scripter

An AI-powered sales teleprompter for Pickle Deeds (pickledeeds.com), grounded in real
word-for-word call scripts and Jeremy Miner's NEPQ (Neuro-Emotional Persuasion Questioning)
principles — lead with curiosity, uncover pain before pitching, let silence work.

## What it does

Guides you in real-time through a sales call — listening to the conversation and surfacing the
right script lines and next questions as the call progresses.

## Call Types & Scripts

The app tracks three call types, each with its own script broken into stages
(`src/shared/callScripts.js`):

- **Intro** — Opening (pattern interrupt) → Permission (TARP) → Context Setup → Discovery →
  Pivot to Options → Decision-Makers Check → Wrap-Up → Objections
- **Offer** — Permission/TARP → Agenda → Pain Recap → Offer Delivery (drop tone, silence) →
  Close → Objections
- **Associate** (locating an heir through a third party) — Opening → Locate the Heir → Build
  Credibility → Get Warm Intro → Objections

The suggestion engine treats these scripts as ground truth: given the rolling call transcript,
it figures out which stage the call is in and surfaces the closest-matching lines from the
script rather than inventing new phrasing.

## Tech Stack

- **Electron** — macOS desktop shell
- **React + Vite** (via `electron-vite`) — renderer UI
- **BlackHole** — system audio capture (not yet wired up)
- **Web Speech API** — speech-to-text (not yet wired up)
- **Claude API** — real-time suggestion engine, grounded in the call scripts above

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

## Using the app

- **Call type** selector (top right) picks which script drives the stage tracker and
  suggestion engine — Intro, Offer, or Associate.
- **Script** button opens a drawer with the full word-for-word script for the current call
  type, auto-scrolled to whichever stage the suggestion engine thinks the call is in.
- **Stage tracker** (below the header) highlights the current stage of that script.
- **Live Transcript** / **Suggested Next Lines** panels show the call so far and the engine's
  suggested next lines, pulled from the script.

## Training Mode

Since there's no live-call audio pipeline yet, the app can replay any saved transcript from
`transcripts/intro/` or `transcripts/offer/` line by line to simulate a live call. This runs
through the exact same suggestion engine a real call will use — only the transcript source
differs — so it's the place to test and tune stage detection and suggestion quality.

In the running app:

1. Pick a transcript from the **Training Mode** dropdown at the bottom of the window — this
   also switches the call type (and Script panel) to match the transcript's category.
2. Use **Play** to auto-advance line by line (adjust speed with the slider), or **Step** to
   advance one line at a time for finer control. **Reset** starts the transcript over.
3. Click **Get Suggestions Now** at any point to send the transcript-so-far to Claude and see
   the detected stage (highlighted in the tracker and in the Script panel) and suggested next
   lines. Check **Auto-request suggestions** to have this happen automatically as the call
   plays — note this calls the Claude API on every update, so it costs more than requesting
   manually.

There are no saved transcripts for the Associate call type yet — switch to it manually with the
call type selector to preview its script.

Requires `ANTHROPIC_API_KEY` to be set in `.env` (see Prerequisites above) — without it,
requesting suggestions shows a clear error instead of a suggestion.
