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
- **Claude API** (Haiku 4.5) — real-time suggestion engine, grounded in the call scripts above,
  tuned for low latency (see [Suggestion latency](#suggestion-latency) below)

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

`transcripts/`, `data/`, and `recordings/` are gitignored — they're meant to hold real seller
call transcripts, audio recordings, and related data locally for development/reference, and
shouldn't be committed since they contain customer PII.

## Using the app

- **Training / Live Call** toggle (top right) switches between replaying a saved transcript and
  an actual live call.
- **Call type** selector picks which script drives the stage tracker and suggestion engine —
  Intro, Offer, or Associate.
- **Script** button opens a drawer with the full word-for-word script for the current call
  type, auto-scrolled to whichever stage the suggestion engine thinks the call is in.
- **Property** button opens a drawer for picking which property/lead the current call is
  about — see [Property Context](#property-context) below. Works the same in Training and Live
  Call mode.
- **Stage tracker** (below the header) highlights the current stage of that script.
- **Live Transcript** / **Suggested Next Lines** panels show the call so far and the engine's
  suggested next lines, pulled from the script.

## Property Context

Beyond the generic script, the suggestion engine can be grounded in specifics about the property
and contact for this call — deceased owner, tax/legal status, known heirs, prior contact notes,
offer amount — pulled from your REISift records.

**Current state: paste-and-parse, not a live REISift sync.** REISift doesn't publish a documented
pull/search API for third-party apps, only a Zapier action and native outbound webhooks (both
configured from REISift's own Settings → Integrations page), and there's no way for this app to
open an authenticated REISift session to fetch a page by URL. So instead:

1. Click **Property** in the header, then **+ New Property**.
2. Copy from REISift and paste it into the **Paste from REISift** box, then click **Parse & Fill
   Fields**. Two ways to copy, and both work:
   - **Select all the visible text** on the page (quick, works for most cases)
   - **Full page HTML** (DevTools → right-click the `<html>` element → Copy → Copy outerHTML) —
     slower to grab, but catches anything in a collapsed accordion or a tab you don't have open,
     since that content still exists in the page's HTML even when it's not currently visible.
     Plain text copy only grabs what's on screen.

   Either way, Claude extracts what it actually finds — deceased owner, property address, tax
   status, known heirs, contact info, prior notes — into the fields below, leaving anything not
   present blank rather than guessing. Review/correct before saving.
3. Before a call, click **Property** and search/select the right one — search matches on label,
   contact name, phone, or address. The selected property shows in the header and feeds every
   suggestion request (Training and Live Call both) until you clear or switch it.

You can still fill the fields in by hand instead — the paste box is optional, just faster.

### Click to call

Any property with a phone number saved shows a **📞 Call** button — in the property list and next
to the selected-property badge. Clicking it hands off to macOS's `tel:` handler (the Phone app /
Continuity Dialer — the same app this whole live-call setup already routes audio through, so
nothing new to configure) to actually place the call, selects that property as the call's
context, and switches the app to Live Call mode. Since the call is dialed *from* that property's
own record, the app already knows who you're calling — no caller-ID detection needed.

Entries are stored locally (`src/main/properties.js`, Electron's userData dir — outside the repo,
never committed, since they're seller PII) and are editable/deletable from the same drawer.

**Property context and prompt caching don't conflict.** The property context is per-call, dynamic
data, so it's injected into the user message alongside the transcript — not into the (cached)
system prompt, which stays byte-identical per call type so caching still works (see
[Suggestion latency](#suggestion-latency) above).

**If/when real REISift API or webhook access gets sorted out:** the local property store's field
shape (`label`, `contactName`, `contactPhone`, `contactRelationship`, `deceasedName`,
`propertyAddress`, `taxStatus`, `caseNumber`, `knownHeirs`, `priorContactNotes`, `offerAmount`,
`painPointsSummary`) is designed so a sync job could populate it directly — the search/pick UI
and the suggestion-engine wiring wouldn't need to change, only how entries get created.

## Live Call

Two ways to capture call audio — the app supports both, and picks whichever you've set up via
the device pickers in the Live Call panel.

### Option A: Single-mic mode (works today, no extra setup)

Dial out through the macOS **Phone app** with the call on **speaker** — not headphones or
AirPods. The built-in mic naturally picks up both your voice and the prospect's, and
Deepgram's diarization guesses which parts are which. Leave **Caller audio** set to "None" in
the Live Call panel. Quality depends on room acoustics (quiet room, Mac speaker/mic both near
you).

### Option B: Dual-stream mode (recommended — exact speaker separation, works with headphones)

Captures your mic and the Phone app's call audio as two independent streams, so there's no
guessing which speaker is which. One-time setup:

1. Install [**BlackHole 2ch**](https://existential.audio/blackhole/) (`brew install --cask
   blackhole-2ch`), then **reboot** — the driver won't be recognized until you do.
2. During calls, set **BlackHole 2ch alone** as your Mac's audio output (Control Center or System
   Settings → Sound → Output). The Phone app doesn't have its own device picker, so this has to be
   the system output while you're on a call.

   **Don't use a Multi-Output Device here.** It's the obvious way to also hear the call live
   while capturing it, but real-time call apps — including the macOS Phone app — appear to
   silently reject aggregate/Multi-Output output devices (likely because they need a real
   hardware device for voice processing) and fall back to the built-in speakers instead, so
   nothing reaches BlackHole. A plain, non-aggregate device like BlackHole 2ch alone works fine.
3. In the Live Call panel, set **Caller audio** to the **BlackHole 2ch** device (auto-selected if
   found) and **Your mic** to your real microphone. Since BlackHole has no speaker, the app plays
   the captured caller audio back out to whatever you pick as **Monitor output** (e.g. your
   headset) — that's how you actually hear them. The panel will confirm it's in dual-stream mode.

Note: setting BlackHole 2ch as system output affects *all* system sound (you'll only hear
anything that the app relays through Monitor output), so switch back to your normal output when
you're not on a call.

### Using it

1. Switch to **Live Call** mode, pick the right **Call type**, and click **Start Call**. macOS
   will prompt for microphone access the first time.
2. Transcribed lines appear labeled **You** / **Them**. In single-mic mode this is a guess
   (whoever speaks first is assumed to be you) — click **Swap Speakers** if it's backwards, which
   relabels the whole transcript so far and everything after. In dual-stream mode labels are
   exact, so there's no Swap button.
3. Suggestions auto-request after the prospect speaks (toggle this off if you'd rather trigger
   them manually with **Get Suggestions Now** — each request calls the Claude API).
4. **End Call** stops the mic and closes the Deepgram connection(s). **Clear** resets the
   transcript before your next call.

### Recordings

Every live call is automatically recorded to `recordings/<call type>/<timestamp>[-property
label]/` — one raw audio file per channel (`audio-mixed.webm` in single-mic mode,
`audio-rep.webm` + `audio-prospect.webm` in dual-stream), `transcript.txt`, and `meta.json` (call
type, matched property if one was selected, start/end time). The **● Recording** indicator next
to the status line confirms it's active; if the recording itself fails to start (e.g. a disk
issue), the call still proceeds — transcription and coaching aren't affected — but an error
banner will say so, since that call went unrecorded.

**Dual-stream calls also get a single merged file, `audio-merged.mp3`** — the two mono channels
combined into one stereo file (you on the left channel, the prospect on the right), for actually
listening back to a call instead of juggling two files. Requires **ffmpeg** on your PATH (`brew
install ffmpeg`); if it's missing, or the merge otherwise fails, the two per-channel `.webm`
files are still saved — you'll just get an error banner and no `audio-merged.mp3` for that call.
Single-mic mode doesn't need this: `audio-mixed.webm` already has both sides of the call.

Like `transcripts/` and `data/`, this folder is gitignored and local-only (real seller PII plus
call audio). **Check your state's call-recording consent law before relying on this** — Texas
(where the calls in this app originate) is one-party consent, but if you're ever calling into or
from a two-party consent state, that changes what's required.

### Suggestion latency

Target is a suggestion on screen within 1-2 seconds of the prospect finishing a sentence. To get
there:

- **Model:** Claude Haiku 4.5, not Sonnet — this is bounded classification/retrieval against a
  fixed script (which line comes next), not open-ended generation, so Haiku is both fast enough
  and cheaper.
- **Prompt caching:** the call script is identical on every request for a given call type, so
  it's marked cacheable (`cache_control: ephemeral`) — only the short rolling transcript gets
  processed fresh each time.
- **Short suggestions:** the prompt caps each suggestion to one sentence under 25 words and
  forbids quoting a whole multi-sentence script passage into one suggestion — both for speed
  (shorter completions) and to avoid the response getting cut off mid-JSON before the
  `max_tokens` cap.
- **Short debounce:** the Live Call panel waits only 300ms after a final transcript line before
  auto-requesting a suggestion (down from an initial 1200ms), since that delay sits entirely on
  the critical path regardless of model speed.

If it's ever still too slow, the next lever to check is Deepgram's own finalization delay
(`utterance_end_ms` / endpointing in `src/main/deepgram.js`) — that's outside the suggestion
engine and adds to the same budget.

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
