// Word-for-word voicemail and SMS scripts for when a call goes unanswered
// — same "ground truth over improvisation" philosophy as the staged call
// scripts in callScripts.js, but shown in the full-screen Start Call prompt
// (see LiveCallPanel.jsx) rather than the Script panel, since they're not
// tied to a call stage — they're for the "no one picked up" branch of any
// call type. Each has a Copy button there so it can be pasted straight into
// Messages.app after tapping Text, rather than retyped or hand-selected out
// of a <pre> block.
//
// Unlike callScripts.js's [NAME]/[DECEASED]-style brackets (which the rep
// always fills in out loud, even when the app could theoretically know the
// answer), {contactName}/{FirstName}/{deceasedName} here ARE resolved from
// whichever property/contact is currently selected — see fillScript. What's
// left as a bracket is only what genuinely isn't on file for any property (a
// specific county, 1-2 identifying details connecting the contact to the
// deceased) — the rep fills those in the same way as callScripts.js.
export const REP_NAME = 'Brandon'

export const VOICEMAIL_SCRIPTS = [
  {
    id: 'attempt-1',
    label: '1st Attempt',
    template: `Hey, I'm not sure if I have the right number, but I am trying to get a hold of {contactName}....

Anyways this is ${REP_NAME}. You don't know me, but I work for a company that acquires inherited property, and we're trying to make contact with the family of the late {deceasedName}

I think {contactName} might be connected to the late {deceasedName} [1-2 details connecting them]

I don't know if any of this makes sense but I wanted to confirm a few details because I think {contactName} might have an interest or be connected with this property.

My number is (512) 779-8656 and if you call and I don't pick up, just send me a text or leave a voicemail and I'll get back to you when I have a moment in between appointments. And if this isn't {contactName} just let me know.

Talk soon…`
  },
  {
    id: 'attempt-3',
    label: '3rd Attempt',
    template: `This is ${REP_NAME} - have been trying to reach {contactName}....

Not sure if I have the wrong person, but the reason for my multiple attempts is that a property tied to {deceasedName}'s family just had a tax delinquency lawsuit filed against it by [COUNTY] County.

We wanted to see if anyone in the family was aware of this, was planning to take care of it, or might want to explore some other options besides letting it be foreclosed.

Thanks again…`
  }
]

// Short follow-up texts, meant to be sent after (or instead of) leaving a
// voicemail — SMS 1st Attempt pairs with the voicemail above ("the message
// above" it refers to), 2nd/3rd are for when even that goes unanswered.
//
// Each slot has 10 pre-written variants saying the same thing different
// ways, rather than one fixed line — texting the exact same wording to
// every lead reads as an obvious mail-merge. `nextSmsVariant` below rotates
// through them (shuffled, round-robin) so LiveCallPanel shows/copies a
// different one each outreach attempt.
export const SMS_SCRIPTS = [
  {
    id: 'sms-1',
    label: 'SMS 1st Attempt',
    variants: [
      `Hi, this is ${REP_NAME} trying to reach {FirstName}. Easier to explain in my last message.`,
      `${REP_NAME} here, looking to connect with {FirstName}. I laid it out in the message above.`,
      `This is ${REP_NAME}, hoping to get in touch with {FirstName}. Details are in the message above.`,
      `Hey, ${REP_NAME} here trying to get a hold of {FirstName}. It's easier to explain in the message above.`,
      `This is ${REP_NAME}. I'm trying to reach {FirstName}, and I explained why in my last message.`,
      `Hi {FirstName}, this is ${REP_NAME}. I left the details in the message above for you.`,
      `${REP_NAME} reaching out here, trying to connect with {FirstName}. Check the message above for context.`,
      `Hi, it's ${REP_NAME}. Trying to get in touch with {FirstName}, more info in my message above.`,
      `This is ${REP_NAME}. I'm hoping to reach {FirstName} and explained the reason in the previous message.`,
      `Hey {FirstName}, this is ${REP_NAME} trying to reach you. I covered the details in the message above.`
    ]
  },
  {
    id: 'sms-2',
    label: 'SMS 2nd Attempt',
    variants: [
      `Is there someone else I could speak with about {deceasedName}, or do I have the wrong number?`,
      `Do you know if there's another person I should contact regarding {deceasedName}, or is this the wrong number?`,
      `Could you point me to someone else about {deceasedName}? Or maybe I have the wrong number.`,
      `I'm trying to reach someone about {deceasedName}. Is there another number I should try, or is this incorrect?`,
      `Would there be someone else available regarding {deceasedName}? Or is this simply the wrong number?`,
      `Is anyone else able to help me with {deceasedName}, or is this not the right number?`,
      `If you're not the right person for {deceasedName}, is there someone else I should reach out to, or did I dial the wrong number?`,
      `I'm hoping to connect about {deceasedName}. Is there someone else to ask, or is this the wrong number?`
    ]
  },
  {
    id: 'sms-3',
    label: 'SMS 3rd Attempt',
    variants: [
      `Obviously this isn't a good time to talk. Call me back whenever works for you.`,
      `Sounds like now isn't the right time. Please call me back when it's more convenient.`,
      `I can tell this isn't a good moment. Give me a call back when you're free.`,
      `This clearly isn't the best time. Feel free to call me back later.`,
      `Seems like I caught you at a bad time. Call me back whenever you get a chance.`,
      `It looks like now doesn't work for you. Please call back when you have a moment.`,
      `This isn't a great time to chat, it seems. Call me back when it's better for you.`,
      `I understand this isn't a good time. Reach out whenever you're able to talk.`,
      `Clearly now isn't ideal for a call. Ring me back when the timing works better.`,
      `Looks like I've caught you at a bad moment. Give me a call back when you're ready to talk.`
    ]
  }
]

const ROTATION_STORAGE_PREFIX = 'scs-sms-rotation-'

function shuffledIndices(count) {
  const order = [...Array(count).keys()]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// Renderer-only (localStorage) — same pattern App.jsx already uses for the
// font-scale preference. Persists per SMS slot so the rotation keeps
// advancing across calls and app restarts instead of resetting each time.
function loadRotation(scriptId, variantCount) {
  try {
    const state = JSON.parse(localStorage.getItem(ROTATION_STORAGE_PREFIX + scriptId))
    if (state && Array.isArray(state.order) && state.order.length === variantCount) return state
  } catch {
    // Missing/corrupt entry — fall through to a fresh shuffle below.
  }
  return { order: shuffledIndices(variantCount), pointer: 0 }
}

function saveRotation(scriptId, state) {
  try {
    localStorage.setItem(ROTATION_STORAGE_PREFIX + scriptId, JSON.stringify(state))
  } catch {
    // Best-effort — worst case the next pick just reshuffles.
  }
}

// Picks the next variant for `scriptId` (one of SMS_SCRIPTS' ids) in a
// shuffled round-robin: every variant gets used once before any repeat, but
// the order isn't the same lap to lap. Call this once per outreach attempt
// (LiveCallPanel keys it off `dialSignal`) rather than on every render, or
// the rotation would advance on unrelated re-renders.
export function nextSmsVariant(scriptId) {
  const script = SMS_SCRIPTS.find((s) => s.id === scriptId)
  if (!script) return ''

  let { order, pointer } = loadRotation(scriptId, script.variants.length)
  if (pointer >= order.length) {
    order = shuffledIndices(script.variants.length)
    pointer = 0
  }

  saveRotation(scriptId, { order, pointer: pointer + 1 })
  return script.variants[order[pointer]]
}

// `contactName`/`deceasedName` fall back to the same bracket convention as
// callScripts.js when nothing's on file — e.g. a Quick Call with no name
// given, or a property with no deceased owner recorded. `{FirstName}` is
// just `contactName`'s first word (a saved contact's full name is what's on
// file — there's no separate first-name field to pull from).
export function fillScript(template, { contactName, deceasedName } = {}) {
  const trimmedContactName = contactName?.trim() || ''
  const firstName = trimmedContactName.split(/\s+/)[0] || ''
  return template
    .replaceAll('{contactName}', trimmedContactName || '[NAME]')
    .replaceAll('{FirstName}', firstName || '[NAME]')
    .replaceAll('{deceasedName}', deceasedName?.trim() || '[DECEASED]')
}
