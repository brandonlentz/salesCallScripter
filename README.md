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

## NEPQ Framework Library

Beyond the word-for-word call scripts, the suggestion engine can also be grounded in general
NEPQ methodology — question patterns, tonality, objection-handling approach — extracted from
uploaded reference material (e.g. Jeremy Miner NEPQ training PDFs).

- **NEPQ Framework** in the header opens the library drawer. **+ Upload PDF** picks a file, then
  **Parse PDF** sends it to Claude (native PDF understanding — no separate OCR step) to distill
  into organized reference notes, shown for review before you save. This is a one-time
  extraction per document, so it uses a stronger model than the live suggestion engine
  (`claude-opus-5` in `src/main/parseNepqReference.js` vs. Haiku for live suggestions) —
  extraction quality here affects every suggestion made afterward.
- Distillation is deliberate, not a transcription: the parser is instructed to pull out
  reusable coaching guidance and skip filler/stories, since the result has to fit efficiently
  into a prompt sent on every suggestion request, not reproduce the whole source document.
- Unlike script variants, there's no "live" selection — every saved reference is included every
  time, across all call types, stacked underneath the word-for-word script. The script always
  stays ground truth for exact wording; reference material only informs style and approach (see
  `src/main/nepqPrompt.js`).
- Stored locally (`src/main/nepqReferences.js`, Electron's userData dir) — never committed. This
  is licensed/proprietary training material, so keep it out of the repo the same way scripts and
  properties already are.

## Tech Stack

- **Electron** — macOS desktop shell
- **React + Vite** (via `electron-vite`) — renderer UI
- **Deepgram** — live speech-to-text with speaker diarization
- **Claude API** (Haiku 4.5) — real-time suggestion engine, grounded in the call scripts above,
  tuned for low latency (see [Suggestion latency](#suggestion-latency) below)
- **Swift / Core Audio** ([native/audiotap](native/audiotap)) — native macOS process-tap helper
  for caller-audio capture without a virtual audio device (see [Live Call](#live-call) below)

## Getting Started

There's no downloadable installer (no `.dmg`/`.app` release) — this runs from a checkout of the
repo via a couple of `npm` commands. It's a few one-time steps, but nothing beyond copy-paste.

### Prerequisites

- **macOS 14.4+** (Sonoma or later), with calls placed through the built-in **Phone app**
  (Continuity Calling from an iPhone signed into the same Apple ID and nearby) so the call audio
  plays through the Mac. Check your version: **Apple menu → About This Mac**.
- **Node.js 18+** and npm (comes with Node) — get it at https://nodejs.org (the LTS installer) if
  you don't have it, then check with `node -v` in Terminal.
- **Xcode Command Line Tools** — needed to compile the native audio-capture helper. Run
  `xcode-select --install` in Terminal if you don't already have them (`xcode-select -p` prints a
  path if you do).
- **ffmpeg** — optional, only needed for the single merged call recording (`audio-merged.mp3`).
  `brew install ffmpeg` if you have [Homebrew](https://brew.sh); everything else works without it.
- An **Anthropic API key** — get one at https://console.anthropic.com/settings/keys (needed for
  suggestions, call scoring, script/PDF parsing — most of what makes this app useful).
- A **Deepgram API key** — get one at https://console.deepgram.com/ (needed for live-call
  transcription).

### 1. Get the code

```bash
git clone https://github.com/brandonlentz/salesCallScripter.git
cd salesCallScripter
```

Or download it as a ZIP from the green **Code** button on GitHub and unzip it, if you don't want
to use git directly — then `cd` into the unzipped folder in Terminal for every step below.

### 2. Install dependencies

```bash
npm install
```

### 3. Add your API keys

```bash
cp .env.example .env
```

Open the new `.env` file in any text editor and fill in both keys from the Prerequisites above:

```
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...
```

`.env` is gitignored — your keys never get committed, even if you later push changes.

### 4. Build the native audio-capture helper (one time)

```bash
npm run build:audiotap
```

This compiles `native/audiotap` (see [Live Call](#live-call) below for what it does). Only needs
re-running if you edit that Swift code — not part of the normal dev loop.

### 5. Run it

```bash
npm run dev
```

This opens the app window. Leave the Terminal window open while you use the app (it's running the
dev server); `Ctrl-C` there, or just quit the app window, to stop.

**First-run checklist**, both one-time macOS permission prompts:

- The first time you dial, macOS asks to approve microphone access — allow it.
- The first time the native audio tap actually captures a call, macOS asks to approve audio
  capture under **System Settings → Privacy & Security → Screen & System Audio Recording** —
  allow it there too (find "Electron" in that list if it's not an immediate popup).

After that, every call just works — see [Live Call](#live-call) below for how it's actually used.

### Everyday use after the first setup

Once steps 1-4 are done, starting the app again is just:

```bash
cd salesCallScripter   # if you're not already there
npm run dev
```

### Updating to a newer version later

```bash
git pull
npm install   # only strictly needed if dependencies changed
```

### Local-only data

`transcripts/`, `data/`, `recordings/`, and `.env` are all gitignored — real seller call
transcripts, audio recordings, and your API keys stay on your machine only, never committed.

### Building a standalone bundle (advanced, optional)

`npm run build` produces a production bundle in `out/`, run with `npm run preview` — same app,
without the dev server/hot-reload. This is **not** a distributable double-click `.app` (no
packaging/code-signing is set up for that yet) — for day-to-day use, `npm run dev` is the normal
path.

## Using the app

- **Call type** selector picks which script drives the stage tracker and suggestion engine —
  Intro, Offer, or Associate.
- **Script** panel (left column) shows the full word-for-word script for the current call type
  the whole time — no drawer to open, it's in view for the entire conversation — auto-scrolled
  to whichever stage the suggestion engine thinks the call is in.
- **Property** button opens a drawer for picking which property/lead the current call is
  about — see [Property Context](#property-context) below.
- **Stage tracker** (below the header) highlights the current stage of that script.
- **Live Transcript** / **Suggested Next Lines** panels show the call so far and the engine's
  suggested next lines, pulled from the script.

Training Mode (replaying a saved transcript against the suggestion engine, no live call needed)
is temporarily disabled — the code is still there (`src/renderer/src/TrainingPanel.jsx`), just
not wired into the header/layout right now.

## Property Context

Beyond the generic script, the suggestion engine can be grounded in specifics about the property
and contact for this call — deceased owner, tax/legal status, known heirs, prior contact notes,
offer amount — pulled from your REISift records.

### Quick Call — when the property doesn't need to be on file

The **Property** drawer has two tabs: **Saved Properties** (below) and **Quick Call**. Quick Call
is for a fast follow-up where grounding the AI in a specific property record isn't worth the
overhead — a callback, a number you already have from a text, anything short. Enter a phone
number (a name is optional but helps — it grounds the suggestion engine's "YOU ARE CALLING" line
the same way a saved contact's name would) and hit **Call**, **FaceTime**, or **Text**. Nothing is
saved to the property store; it's just enough context for that one call. Live Call/recording still
works exactly the same way.

**Records sync live from REISift via an outbound webhook** — no more copy/paste for properties
REISift already knows about. REISift doesn't publish a pull/search API, but it does support
outbound webhooks (Settings → Integrations → Webhooks, fired from a sequence's "Webhook" action),
and `src/main/reisiftWebhookSocket.js` receives exactly that.

### Wiring up the live sync

REISift is a hosted SaaS; this is a desktop app behind your router's NAT, so REISift can't reach
it directly. Rather than exposing a local port via a tunnel (ngrok/Cloudflare/Tailscale — more
moving parts, extra software to keep running), this app subscribes to a **webhook.site** URL's
events over WebSocket — an outbound connection from this app to webhook.site, the same shape as
the existing Deepgram connections, so nothing on this machine needs to accept inbound traffic at
all:

1. Go to [webhook.site](https://webhook.site) — it hands you a unique URL immediately, no signup
   required (e.g. `https://webhook.site/4197cd04-a2ac-4e62-bfc3-553946c42459`).
2. Put that URL in `.env` as `REISIFT_WEBHOOK_SITE_URL` and restart the app. On startup it opens a
   WebSocket to webhook.site and subscribes to that URL's events — check the console for
   `[reisift-socket] connected, subscribing to token …`, and the Property drawer shows a live
   `🔄 Connected to webhook.site` status line.
3. In REISift: Settings → Integrations → Webhooks → paste the **same** URL as the webhook target,
   then attach it to whichever sequence(s) should push updates (e.g. "card moved to a list"
   triggers). Every delivery REISift makes to that URL now reaches this app in real time, synced
   or not, whether or not the webhook.site page itself is open in a browser.

**Free/anonymous webhook.site URLs have real limits, and this project runs on one deliberately** —
a free URL stops accepting new requests after **100 total, or 7 days, whichever comes first**,
and REISift just gets a silent 410/429 with no error surfaced to this app. webhook.site Pro
removes both caps, but the cost wasn't judged worth it here — when the URL dies, generate a new
one at webhook.site, update `REISIFT_WEBHOOK_SITE_URL` in `.env`, restart the app, and paste the
new URL into REISift's webhook settings in place of the old one. The `🔄` status line in the
Property drawer only reports the WebSocket connection to webhook.site itself, not whether the
*page's own URL* has hit its cap — there's no signal for that, so if syncs quietly stop arriving,
suspect an expired/capped URL first.

**No signature verification** — REISift signs deliveries (`x-sift-webhook-signature` /
`x-sift-webhook-timestamp`) but doesn't publish the HMAC scheme in their docs, so anything posted
to the webhook.site URL is accepted and synced. Acceptable for now since the URL itself is an
unguessable token, but worth tightening if REISift's dashboard ever surfaces a signing secret.

**Why `socket.io-client@2` specifically:** webhook.site's WebSocket server only speaks the old
Engine.IO v3 wire protocol that Socket.IO v2 clients use — a v3/v4 client can't complete the
handshake at all. Pinned deliberately in `package.json`; don't "upgrade" it.

### What gets synced, and what doesn't

Matched by REISift's own `property.uuid`, not this app's local id — so the same property is
created once and updated in place on every later webhook, no duplicates:

- **REISift owns** (always overwritten by a sync): property address, tax/legal milestone dates
  (rolled into a one-line `taxStatus` summary), contacts and their phone numbers/tags, and
  REISift's own status/tags/lists (shown as a `🔄` badge on the selected property).
- **You own** (a sync never touches these once set): the property's display label, offer amount,
  pain-points summary, and each phone's local call-outcome tag (see [Multiple contacts, multiple
  numbers](#multiple-contacts-multiple-numbers) below) — *except* REISift reporting a contact as
  DNC always forces that tag to **DNC** regardless of what was set locally, since that's a
  compliance signal, not a coaching note.
- Nothing is ever deleted by a sync — a contact or number missing from one payload isn't treated
  as proof they're gone, only new/changed data is applied.

### Manual entry still works

The **paste-and-parse** flow (click **Property** → **+ New Property** → paste REISift's page text
or HTML into **Paste from REISift** → **Parse & Fill Fields**) is still there for properties you
haven't wired a webhook for, or want to add ad hoc. It writes the exact same local shape the
webhook sync does, so both paths are interchangeable — a property started by hand can still get
picked up and enriched by a later webhook if its `property.uuid` happens to match, though in
practice hand-entered properties won't have one until REISift's webhook creates its own copy.

Either way: before a call, click **Property** and search/select the right one — search matches on
label, contact name, phone, or address. The selected property shows in the header and feeds every
suggestion request (Training and Live Call both) until you clear or switch it. If a webhook syncs
an update to the property you're currently on — even mid-call — the header and suggestion context
refresh automatically, no need to re-select it.

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

### Click to call, FaceTime, or text

Each contact's number in the expanded **Property** panel has three buttons:

- **📞 Call** — hands off to macOS's `tel:` handler (the Phone app / Continuity Dialer — the same
  app this whole live-call setup already routes audio through) and pops the full-screen Start Call
  prompt — see [Using it — both starting and ending are one click, neither is
  automatic](#using-it--both-starting-and-ending-are-one-click-neither-is-automatic) above.
- **🎥 FaceTime** — hands off to `facetime:`, opens FaceTime.app, and pops the same prompt (it's
  still a "call" for coaching purposes). The native tap likely captures FaceTime audio too — the
  same underlying daemon (`com.apple.avconferenced`) is believed to handle both — but that's only
  been directly confirmed on real Phone calls so far, not FaceTime. Try it and see; if
  transcription doesn't pick up the other side, the Phone/Continuity path is the well-tested one.
- **💬 Text** — hands off to `sms:`, opening Messages.app with that conversation ready to go. This
  one does **not** start the Live Call panel — there's no call audio to capture, and it doesn't
  send anything on your behalf; you still type and hit send yourself.

The compact search-results list only shows the **📞** shortcut (first contact, first number) — open
the property (click its row) to get the FaceTime/text options for every contact and number.

Since a call/FaceTime dial is placed *from* that specific contact's own saved number, the app
already knows exactly who you're calling — no caller-ID detection needed — and passes that
contact's name and relationship to the suggestion engine as `YOU ARE CALLING: ...` (see
`buildPropertyContext` in `src/main/nepqPrompt.js`), not just the property in general. That
matters once a property has several contacts, each with several numbers, and the script has a
`[NAME]`-style placeholder to fill in. If a call ever starts without a specific contact selected
(e.g. you pick a property but don't click a numbered contact), nothing is guessed — the
placeholder stays a placeholder.

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

This is exactly what the REISift webhook sync (above) does now — the local property store's field
shape (`label`, `contacts` — each `{ name, relationship, phones: [{ number, label, status }] }` —
`deceasedName`, `propertyAddress`, `taxStatus`, `caseNumber`, `knownHeirs`, `priorContactNotes`,
`offerAmount`, `painPointsSummary`, plus `reisiftUuid`/`reisiftStatus`/`reisiftTags`/`reisiftLists`
on synced records) was designed up front so a sync job could populate it directly — the search/
pick UI and the suggestion-engine wiring didn't need to change, only how entries get created.

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
2. That's it — no further configuration. It auto-detects the daemon that actually renders call
   audio, which is *not* the visible Phone/FaceTime app itself — see `native/audiotap/main.swift`'s
   header comment for why.
3. The first time it captures, macOS will show a one-time system permission prompt — approve it
   under System Settings → Privacy & Security → **Screen & System Audio Recording**.

If the helper isn't built yet, or macOS denies the permission, the panel will show what went wrong.

### Using it — both starting and ending are one click, neither is automatic

Dialing any phone number (in **Property**, see below) does **not** start recording/transcription
by itself — it only selects that property/contact as call context and pops a **full-screen Start
Call prompt** over the whole window, so the click to actually start it is impossible to miss
whether you're mid-conversation already or the panel's scrolled out of view. Hit **Start Call**
there (or dismiss it with **Not now** / ✕ if you're not ready yet — the regular Start Call button
in the Live Call panel is still there either way). This is deliberate: an earlier version
auto-started recording the instant you dialed, but that meant a call that had already been going
for a minute before you picked up the phone from this app got its opening cut off in the
recording — one manual click (now hard to miss) beats a silent auto-start.

The prompt also carries everything you'd otherwise have to leave it to find:

- **🎥 FaceTime / 💬 Text** buttons for the exact number you just dialed, in case the call doesn't
  connect and you want to switch approach without going back to **Property**.
- **Disposition buttons** (✅ Correct / ❌ Wrong number / 📵 No answer / 🚫 DNC / 💀 Dead) for that
  same number — same call-outcome tag as the Property drawer's phone list (see [Multiple contacts,
  multiple numbers](#multiple-contacts-multiple-numbers)), settable right here without opening it.
  Only shown for a saved property; a Quick Call has no record to tag it against.
- **Voicemail scripts** (`src/shared/voicemailScripts.js`) — word-for-word "1st Attempt" / "3rd
  Attempt" scripts for when it goes to voicemail, with the contact's name and the deceased owner's
  name filled in automatically from whatever property/contact is selected (falling back to the
  same `[NAME]`/`[DECEASED]` bracket convention as the staged call scripts when nothing's on file).
  A couple of things — a specific county, 1-2 identifying details connecting the contact to the
  deceased — aren't on file for any property and stay bracketed for you to fill in out loud.

**Ending is manual too — click End Call when you hang up.** An earlier version tried to
auto-detect hangup from the tapped audio going quiet, but macOS doesn't expose real call-state to
third-party apps, so that was a heuristic guess — and a real, long silence (a rep on hold, a long
thinking pause) would have ended the call early. One click is simpler and never wrong.

1. Pick the right **Call type** before dialing (or after — the suggestion engine picks it up
   either way). Dial a contact's number from **Property** — see [Property Context](#property-context).
2. Transcribed lines appear labeled **You** / **Them** — exact, no guessing.
3. Suggestions auto-request after the prospect speaks (toggle this off if you'd rather trigger
   them manually with **Get Suggestions Now** — each request calls the Claude API).
4. Click **End Call** when you hang up — the **Live Transcript** panel clears for the next call,
   and the [Call Summary popup](#call-summary) below appears.

### Recordings

Every call is automatically recorded to `recordings/<call type>/<timestamp>[-property label]/` —
`audio-rep.webm` + `audio-prospect.raw` (the prospect channel is headerless PCM from the native
tap, not webm), `transcript.txt`, and `meta.json` (call type, matched property if one was
selected, start/end time). This happens even for a misdial or no-answer — you just get a short or
empty transcript. The **● Recording** indicator next to the status line confirms it's active; if
the recording itself fails to start (e.g. a disk issue), the call still proceeds — transcription
and coaching aren't affected — but an error banner will say so, since that call went unrecorded.

**Calls also get a single merged file, `audio-merged.mp3`** — the two mono channels combined into
one stereo file (you on the left channel, the prospect on the right), for actually listening back
to a call instead of juggling two files. Requires **ffmpeg** on your PATH (`brew install ffmpeg`);
if it's missing, or the merge otherwise fails, the two per-channel files are still saved — you'll
just get an error banner and no `audio-merged.mp3` for that call.

## Call Summary

A popup (`src/renderer/src/CallSummaryModal.jsx`) appears automatically the moment you click
**End Call**:

- Confirms the recording was saved, with a **Show in Finder** link to the call's folder.
- If any conversation was actually captured, Claude grades the rep's performance 1-10 against
  Jeremy Miner's NEPQ framework (using any uploaded [NEPQ Framework Library](#nepq-framework-library)
  material to inform the grading criteria, same as live suggestions) — a short summary, what went
  well, what went poorly, and specific things to work on next time (`src/main/callAnalysis.js`).
  A misdial/no-answer with nothing said just skips grading and says so.
- Uses `claude-opus-5` rather than the Haiku model live suggestions use — this runs once per call,
  not on the live-call latency path, so it's worth the stronger model for coaching-quality
  feedback. Every call now triggers one of these requests, so this is a real per-call cost, not a
  one-time setup cost like the NEPQ PDF parsing — worth knowing since it scales with call volume.

Requires `ANTHROPIC_API_KEY` — without it, the popup shows an error instead of a graded summary
(the recording is unaffected either way).

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

**Currently disabled in the UI** — not removed, just not wired into the header/layout for now
(see [Using the app](#using-the-app) above). The code below is accurate for whenever it's
switched back on.

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
