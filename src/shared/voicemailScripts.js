// Word-for-word scripts for when a call goes to voicemail or just isn't
// answered — same "ground truth over improvisation" philosophy as the
// staged call scripts in callScripts.js, but shown in the full-screen
// Start Call prompt (see LiveCallPanel.jsx) rather than the Script panel,
// since they're not tied to a call stage — they're for the "no one picked
// up" branch of any call type.
//
// Unlike callScripts.js's [NAME]/[DECEASED]-style brackets (which the rep
// always fills in out loud, even when the app could theoretically know the
// answer), {contactName}/{deceasedName} here ARE resolved from whichever
// property/contact is currently selected — see fillVoicemailScript. What's
// left as a bracket is only what genuinely isn't on file for any property
// (a specific county, 1-2 identifying details connecting the contact to
// the deceased) — the rep fills those in the same way as callScripts.js.
export const REP_NAME = 'Brandon'

export const VOICEMAIL_SCRIPTS = [
  {
    id: 'attempt-1',
    label: '1st Attempt',
    template: `Hey, I'm not sure if I have the right number, but I am trying to get a hold of {contactName}....

Anyways this is ${REP_NAME}. You don't know me, but I work for a private investigation firm in Washington DC….. that has been hired by a client in Texas….. to research the family history and title on a property that was owned by the late {deceasedName}

I think {contactName} might be connected to the late {deceasedName} [1-2 details connecting them]

I don't know if any of this makes sense but I wanted to confirm a few details because I think {contactName} might have an interest or be connected with this property.

My number is (512) 779-8656 and if you call and I don't pick up, just send me a text or leave a voicemail and I'll get back to you when I have a moment in between appointments. And if this isn't {contactName} just let me know.

Talk soon…`
  },
  {
    id: 'attempt-3',
    label: '3rd Attempt',
    template: `This is ${REP_NAME} - have been trying to reach {contactName}....

Not sure if I have the wrong person, but the reason for my multiple attempts is that the property my client has asked me to research just had a tax delinquency lawsuit that was filed against it by [COUNTY] County.

We wanted to see if anyone in the family was aware of this, was planning to take care of it, or might want to explore some other options with my client besides letting it be foreclosed.

Thanks again…`
  }
]

// `contactName`/`deceasedName` fall back to the same bracket convention as
// callScripts.js when nothing's on file — e.g. a Quick Call with no name
// given, or a property with no deceased owner recorded.
export function fillVoicemailScript(template, { contactName, deceasedName } = {}) {
  return template
    .replaceAll('{contactName}', contactName?.trim() || '[NAME]')
    .replaceAll('{deceasedName}', deceasedName?.trim() || '[DECEASED]')
}
