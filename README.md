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
- **Deepgram** — live speech-to-text with speaker diarization
- **Claude API** — real-time suggestion engine, grounded in the call scripts above

## Getting Started

### Prerequisites

- **macOS**, with calls placed through the built-in **Phone app** (Continuity Calling from an
  iPhone) so the call audio plays through the Mac
- **Node.js 18+** and npm (comes with Node) — check with `node -v`
- An **Anthropic API key** — get one at https://console.anthropic.com/settings/keys
- A **Deepgram API key** (for live calls only, not Training Mode) — get one at
  https://console.deepgram.com/

### Install

```bash
git clone https://github.com/brandonlentz/salesCallScripter.git
cd salesCallScripter
npm install
cp .env.example .env   # then add ANTHROPIC_API_KEY and DEEPGRAM_API_KEY
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

- **Training / Live Call** toggle (top right) switches between replaying a saved transcript and
  an actual live call.
- **Call type** selector picks which script drives the stage tracker and suggestion engine —
  Intro, Offer, or Associate.
- **Script** button opens a drawer with the full word-for-word script for the current call
  type, auto-scrolled to whichever stage the suggestion engine thinks the call is in.
- **Stage tracker** (below the header) highlights the current stage of that script.
- **Live Transcript** / **Suggested Next Lines** panels show the call so far and the engine's
  suggested next lines, pulled from the script.

## Live Call

1. Dial out through the macOS **Phone app**, with the call on **speaker** — not headphones or
   AirPods. Audio capture is a single built-in-mic stream; with the call on speaker, the mic
   naturally picks up both your voice and the prospect's, and Deepgram's diarization splits it
   back into two speakers. (No BlackHole or virtual audio device needed.)
2. Switch to **Live Call** mode, pick the right **Call type**, and click **Start Call**. macOS
   will prompt for microphone access the first time.
3. As the call plays out, transcribed lines appear labeled **You** / **Them** — whoever speaks
   first is assumed to be you. If that guess is backwards, click **Swap Speakers** to relabel
   the whole transcript so far (and everything after).
4. Suggestions auto-request after the prospect speaks (toggle this off if you'd rather trigger
   them manually with **Get Suggestions Now** — each request calls the Claude API).
5. **End Call** stops the mic and closes the Deepgram connection. **Clear** resets the
   transcript before your next call.

Requires `DEEPGRAM_API_KEY` in `.env` — without it, **Start Call** shows a clear error instead
of connecting.

## Training Mode

The app can also replay any saved transcript from `transcripts/intro/` or `transcripts/offer/`
line by line to simulate a live call, without needing a real call or microphone. It runs
through the exact same suggestion engine live calls use — only the transcript source differs —
so it's the place to test and tune stage detection and suggestion quality.

In the running app:

1. Pick a transcript from the **Training Mode** dropdown at the bottom of the window — this
   also switches the call type (and Script panel) to match the transcript's category.
2. Use **Play** to auto-advance line by line (adjust speed with the slider), or **Step** to
   advance one line at a time for finer control. **Reset** starts the transcript over.
3. Click **Get Suggestions Now** at any point to send the transcript-so-far to Claude and see
   the detected stage and suggested next lines. Check **Auto-request suggestions** to have this
   happen automatically as the call plays — note this calls the Claude API on every update, so
   it costs more than requesting manually.

There are no saved transcripts for the Associate call type yet — switch to it manually with the
call type selector to preview its script.

Requires `ANTHROPIC_API_KEY` to be set in `.env` — without it, requesting suggestions shows a
clear error instead of a suggestion.
