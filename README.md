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

## Script Variants

Each call type can have more than one version of its script — a lightweight way to
split-test wording (a different opening, a reworded objection response) without touching
code. Every call type always has an **Original** variant (the scripts described above,
un-deletable); anything else you add is a named alternative you can switch to per call.

- The **Script** dropdown next to **Call type** in the header picks which variant is live —
  it controls both what the suggestion engine grounds itself in and what the Script drawer
  shows.
- **Manage Scripts** opens a drawer to view all variants for the current call type, delete
  ones you no longer want (Original can't be deleted), or add a new one.
- **+ New Variant**: paste in a script draft — headed with `### Stage — Title` sections like
  the built-in scripts, or much rougher (notes, a rough draft, a transcript from other source
  material) — and click **Parse Script**. Claude structures it into sections, shown for review
  (title + line count + a preview of the first line) before you save. On loose, non-quoted
  notes the parser will lightly turn description into spoken lines rather than only extracting
  verbatim quotes — review the result rather than assuming it's a literal transcription.

There's no in-app outcome tracking (win/loss) tied to variants — this is judge-by-ear/by-results,
not a statistical A/B test. Variants are stored locally (`src/main/scriptVariants.js`, Electron's
userData dir — not committed, and not PII, just kept there so adding one never needs a rebuild)
and are picked up by both Training Mode and Live Call, since both call the same suggestion
engine.

## Tech Stack

- **Electron** — macOS desktop shell
- **React + Vite** (via `electron-vite`) — renderer UI
- **Deepgram** — live speech-to-text with speaker diarization
- **Claude API** (Haiku 4.5) — real-time suggestion engine, grounded in the call scripts above,
  tuned for low latency (see [Suggestion latency](#suggestion-latency) below)
- **Swift / Core Audio** ([native/audiotap](native/audiotap)) — native macOS process-tap helper
  for caller-audio capture without a virtual audio device (see [Live Call](#live-call) below)

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

### Multiple contacts, multiple numbers

A property/lead often has several people worth calling — heirs, a spouse, an associate — each
with several phone numbers of their own (REISift itself often lists a dozen numbers per owner
record, each tagged with whose it is). So a property's `contacts` field is a list, and each
contact has its own list of `{ number, label }` phones, not one flat name/phone pair.

- **Paste & parse** groups numbers under the right person automatically, using REISift's own
  phone tags/tooltips (e.g. "Tiffany Reece - Darlene great niece") to tell whose number is whose.
- **The property form** lets you add/remove contacts and, within each, add/remove numbers by
  hand.
- **The selected-property panel** lists every contact with every one of their numbers as its own
  **📞** button — click the specific number you want to dial.
- **The property list** (search results) shows one quick-call button per row, calling the first
  contact's first number — a `(N)` badge next to it means there are more numbers on file; open
  the property to see and call the rest.

### Click to call

Clicking any **📞** button hands off to macOS's `tel:` handler (the Phone app / Continuity Dialer
— the same app this whole live-call setup already routes audio through, so nothing new to
configure) to actually place the call, selects that property as the call's context, and switches
the app to Live Call mode. Since the call is dialed *from* that contact's own saved number, the
app already knows who you're calling — no caller-ID detection needed.

Entries are stored locally (`src/main/properties.js`, Electron's userData dir — outside the repo,
never committed, since they're seller PII) and are editable/deletable from the same drawer.
Records saved before multi-contact support (a single contact name/phone/relationship) are
migrated to the `contacts[]` shape automatically the next time they're loaded — no manual fixup
needed.

**Property context and prompt caching don't conflict.** The property context is per-call, dynamic
data, so it's injected into the user message alongside the transcript — not into the (cached)
system prompt, which stays byte-identical per call type + script variant so caching still works
(see
[Suggestion latency](#suggestion-latency) above).

**If/when real REISift API or webhook access gets sorted out:** the local property store's field
shape (`label`, `contacts` — each `{ name, relationship, phones: [{ number, label }] }` —
`deceasedName`, `propertyAddress`, `taxStatus`, `caseNumber`, `knownHeirs`, `priorContactNotes`,
`offerAmount`, `painPointsSummary`) is designed so a sync job could populate it directly — the
search/pick UI and the suggestion-engine wiring wouldn't need to change, only how entries get
created.

## Live Call

Call audio is captured via **native audio capture**: a native Core Audio process-tap
([native/audiotap](native/audiotap)) that reads the call app's audio directly — no virtual audio
driver, no system Output switching. Your speakers/headset and mic just stay on whatever your Mac's
normal defaults are; there's nothing to pick or configure. Speaker labels are exact (your mic is
its own channel, the tapped call audio is the other), no diarization guessing involved.

(BlackHole-based dual-stream and single-mic acoustic-pickup modes were tried earlier and removed
— BlackHole in particular turned out to interfere with real call audio on macOS. See project memory
if you're digging into that history.)

Setup:

1. One-time build: `npm run build:audiotap` (requires Xcode Command Line Tools — `xcode-select
   --install` if you don't already have them).
2. That's it — click **Start Call**. The **Process name override** field in the Live Call panel is
   an advanced/debug option only; leave it blank (it auto-detects the daemon that actually renders
   call audio, which is *not* the visible Phone/FaceTime app itself — see
   `native/audiotap/main.swift`'s header comment for why).
3. The first time it captures, macOS will show a one-time system permission prompt — approve it
   under System Settings → Privacy & Security → **Screen & System Audio Recording**.

If the helper isn't built yet, or macOS denies the permission, the panel will show what went wrong.

### Using it

1. Switch to **Live Call** mode, pick the right **Call type**, and click **Start Call**. macOS
   will prompt for microphone access the first time.
2. Transcribed lines appear labeled **You** / **Them** — exact, no guessing.
3. Suggestions auto-request after the prospect speaks (toggle this off if you'd rather trigger
   them manually with **Get Suggestions Now** — each request calls the Claude API).
4. **End Call** stops the mic and closes the Deepgram connection(s). **Clear** resets the
   transcript before your next call.

### Recordings

Every live call is automatically recorded to `recordings/<call type>/<timestamp>[-property
label]/` — `audio-rep.webm` + `audio-prospect.raw` (the prospect channel is headerless PCM from
the native tap, not webm), `transcript.txt`, and `meta.json` (call type, matched property if one
was selected, start/end time). The **● Recording** indicator next to the status line confirms
it's active; if the recording itself fails to start (e.g. a disk issue), the call still proceeds
— transcription and coaching aren't affected — but an error banner will say so, since that call
went unrecorded.

**Calls also get a single merged file, `audio-merged.mp3`** — the two mono channels combined into
one stereo file (you on the left channel, the prospect on the right), for actually listening back
to a call instead of juggling two files. Requires **ffmpeg** on your PATH (`brew install ffmpeg`);
if it's missing, or the merge otherwise fails, the two per-channel files are still saved — you'll
just get an error banner and no `audio-merged.mp3` for that call.

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
- **Prompt caching:** the call script is identical on every request for a given call type +
  script variant, so it's marked cacheable (`cache_control: ephemeral`) — only the short
  rolling transcript gets processed fresh each time.
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
