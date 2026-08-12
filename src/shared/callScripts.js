// Word-for-word call scripts, ported from the call-tracker project's
// ScriptDrawer.tsx (github.com/brandonlentz/call-tracker). These are the
// actual scripts to guide the call — the suggestion engine treats them as
// ground truth and the Script panel shows them verbatim, auto-scrolled to
// whatever stage the suggestion engine thinks the call is in.
//
// Single source of truth for both the main process (suggestion engine
// prompt) and the renderer (stage tracker + Script panel).

const INTRO_SCRIPT = [
  {
    stage: 'opening',
    title: 'Opening — Pattern Interrupt',
    lines: [
      `"Hi, I'm not sure I have the right number — is this [NAME]?" [PAUSE]`,
      `"Oh that's great… I've been trying to get a hold of you."`,
      `"My name is Brandon… [last name]. You don't know me, and I'm not even sure it makes sense to talk, but I work for a private detective firm in Washington D.C…. [playful] and you are not in trouble or anything…" [PAUSE]`,
      `"We were hired by a client in Texas to research and make contact with the family of the late [DECEASED] who… [2–3 family/history details]."`,
      `IF HEIR: "Based on our research, I believe you might be related to the late [DECEASED], who I believe was your [grandma/grandfather/etc.]."`,
      `IF NON-HEIR: "The reason I'm calling is I'm trying to get a hold of [heir name] who I think might be your [friend/sister/relative]."`,
      `"I want to take a pause and make sure — do I have the wrong person?" [Confirm relationship. Let them talk.]`
    ]
  },
  {
    stage: 'permission',
    title: 'TARP — Permission to Continue',
    lines: [
      `"Like I said, our client wanted us to reach out about this property…"`,
      `"Would it be a problem if I took 2–3 minutes to ask a few questions and see if it makes sense to talk further?"`,
      `"If it doesn't make sense, I'm totally fine ending the call."`
    ]
  },
  {
    stage: 'context',
    title: 'Context Setup — Neutral Facts Only',
    lines: [
      `"What brought this onto our radar is a property [DECEASED] left behind — the one on [ADDRESS]."`,
      `[State why it's fractured: no will, probate incomplete, family details. DO NOT mention financial distress or taxes yet.]`,
      `"Before I keep going — am I still tracking correctly?" [PAUSE — let them talk. Live in this space as long as possible.]`
    ]
  },
  {
    stage: 'discovery',
    title: 'Discovery — Ask Questions & Listen',
    lines: [
      `Q1: "Have you ever seen the property yourself?"`,
      `Q2: "Do you know if anyone lives on the property?"`,
      `Q3: "Has anyone in the family been handling the expenses or taxes?"`,
      `Q4: "What's your understanding of what might happen with the property?"`,
      `[Answer their questions with a question. Keep answers to 2–4 sentences max.]`,
      `TAX SURPRISE: "This may come as a surprise — is the family aware that the property recently had a lawsuit filed by the county for back taxes?"`,
      `[PAUSE. Let them open up. Go back to questions to get more detail.]`
    ]
  },
  {
    stage: 'pivot',
    title: "Pivot to Options — Don't Sell",
    lines: [
      `"My role is purely fact-finding at this stage. Heirs in these situations typically have a few paths including:"`,
      `"— Do nothing and potentially let the county foreclose on the property"`,
      `"— Hire an attorney and spend time and money to pay taxes and resolve issues"`,
      `"— Or entertain some possible options for their interest. In addition to the research work, I also work with the client in a separate capacity to help them acquire properties that have messy titles…"`,
      `"If that's something of interest, I can have them take a look…"`,
      `[BE QUIET. WHOEVER TALKS FIRST LOSES.]`,
      `IF INTERESTED: "Would it be a problem if I spoke with my manager and called you back in about 15 minutes to see what might be possible?"`,
      `IF NOT INTERESTED: "Okay — I want to be clear, I'm not even sure we could make an offer, but if we can I'd still need to talk to my manager and walk you through what working with us looks like on the next call."`
    ]
  },
  {
    stage: 'decision-makers',
    title: 'Decision Makers Check',
    lines: [
      `"After you review the info I'll send over, is there anything else you'd need to make a yes or no decision? And no is totally fine if this isn't a good fit."`,
      `"One last thing — is there anyone else that will be helping you with this that should be on the call, like a significant other, friend, or family member?" [Confirm TWICE — "You sure?"]`,
      `IF YES: "Got it… did they know you're on this call right now, or are you on a secret mission?" [they'll laugh]`,
      `"When you say you need to talk with them — is that more like checking in, or getting their permission?"`,
      `IF PERMISSION: "Great — will they be available for the call as well?" [CRITICAL — get them on the next call]`,
      `IF CHECKING IN: "Thanks for letting me know." [No further action needed]`
    ]
  },
  {
    stage: 'wrap-up',
    title: 'Wrap Up — TARP Close + Follow-Up',
    lines: [
      `Confirm next call time. "Yes or no is totally fine."`,
      `SMS 1: "[Seller] — this is [name]. We just spoke re: [address] and [deceased]. pickledeeds.com | [email]"`,
      `SMS 2: "This is my client, talk soon: linkedin.com/in/chris-burns-b7551a24/"`,
      `IF 5+ minute call or strong convo: SEND pickledeeds.com website link.`,
      `OPTIONAL: If requested, send case number, tax links, land records.`
    ]
  },
  {
    stage: 'objection',
    title: 'Objections',
    lines: [
      `SCAM / WHO ARE YOU: "Totally fair — I work for Privates ID, a PI firm in D.C. I can text you our info at the end. Would it be a problem to speak for 2 minutes?"`,
      `NOT INTERESTED: "I'm so sorry — I'm not even sure I can help. Are you getting a lot of these calls?"`,
      `TAKING CARE OF IT: [MIRROR] "Taking care of it?" [curious tone] "How did it get to this point?"`,
      `WHAT IS THIS ABOUT: "A tax foreclosure lawsuit was filed. We wanted to see if family was aware, planned to take care of it, or might consider other options."`,
      `CAN I DO THIS MYSELF: "Absolutely — most people need an attorney, genealogist, pay back taxes, and possibly file for probate. What's your sense of how likely that is?"`
    ]
  }
]

const OFFER_SCRIPT = [
  {
    stage: 'permission',
    title: 'Permission + TARP',
    lines: [
      `"Hey [Seller], this is [Name]. Do you have about 5 minutes for a quick conversation?"`,
      `"So I spoke with my client and they let me know what they can offer — but before we talk about that, they'd like me to walk you through what it looks like if you decide to work with them. Would that be a problem?"`,
      `"At the end of our conversation, after I let you know their offer, do you feel you'll have enough information to make a confident YES… or NO… decision? And no is perfectly fine."`
    ]
  },
  {
    stage: 'agenda',
    title: 'Agenda — Explain the Process',
    lines: [
      `Walk through: DocuSign agreement (~5 min) → closing package with attorney → mobile notary comes to them → sign deed + docs → funds sent by preferred method.`,
      `"Do you have any questions?" [WAIT]`
    ]
  },
  {
    stage: 'pain-recap',
    title: 'Pain Recap — Before the Number',
    lines: [
      `"So about the situation — [3 pain points in 30 seconds]."`,
      `"I spoke with my client and explained [pain 1], [pain 2], [pain 3]."`,
      `"[What the sale accomplishes — financially AND emotionally.]"`,
      `[Make sure they FEEL the pain before the number is said.]`
    ]
  },
  {
    stage: 'offer-delivery',
    title: 'Offer Delivery — Drop Tone',
    lines: [
      `DROP THE TONE. Slow down. Sound like you're delivering hard news.`,
      `"This is the toughest part of my job right now because I am on your side and I don't want to let you down — but at the end of the day I am at the mercy of my boss."`,
      `"With that being said, I can qualify you for $[AMOUNT]."`,
      `[PAUSE. SAY NOTHING. Let silence work. First one to speak loses.]`
    ]
  },
  {
    stage: 'close',
    title: 'Close',
    lines: [
      `"Is there anything else you'd like to go over before I get the agreement drafted?"`,
      `Get: date + time for signing AND email to send docs for review.`
    ]
  },
  {
    stage: 'objection',
    title: 'Objections',
    lines: [
      `THINK ABOUT IT: "How long do you need?" [QUIET] "What exactly do you have to figure out between now and then?"`,
      `SPOUSE: "As you talk with them, what do you think their main concern will be?" [They reveal real objection]`,
      `TOO LOW: "Given everything going on, what do you think would be a fair number?" [SHUT UP]`,
      `SCAM: "[Seller], put yourself in my shoes — how do I know I'm paying the right person? That's why we use a licensed notary. [playful]"`
    ]
  }
]

const ASSOCIATE_SCRIPT = [
  {
    stage: 'connecting',
    title: 'Opening',
    lines: [
      `"Hi, is this [Associate Name]? Hey [Name], this is [Rep Name] — I'm calling from a research company. Do you have about 2 minutes?"`,
      `Tone: Favor-asking. Casual and non-threatening.`
    ]
  },
  {
    stage: 'locating',
    title: 'Locate the Heir',
    lines: [
      `"I'm trying to get in touch with [Heir Name] regarding research on a property owned by [Deceased]. Would you happen to know how I might reach them?"`,
      `"It's related to a legal filing — nothing alarming, but it's something [Heir Name] would want to know about."`
    ]
  },
  {
    stage: 'credibility',
    title: 'Build Credibility',
    lines: [
      `"We're Privates ID, a PI firm in D.C., working for a Texas real estate company. We found [Heir]'s info through court records related to the property."`,
      `Less is more — over-explaining raises suspicion.`
    ]
  },
  {
    stage: 'warm-intro',
    title: 'Get the Warm Intro',
    lines: [
      `Option A: "Do you have a number or email for [Heir] I could reach directly?"`,
      `Option B: "Would it be a problem if I gave you my info to pass along? [Heir] can decide whether to call back."`,
      `Option C: "Would you be open to a quick 3-way call right now? Just 2 minutes."`
    ]
  },
  {
    stage: 'objection',
    title: 'Objections',
    lines: [
      `WON'T SHARE INFO: "Totally understandable. Would it be a problem if I gave YOU my info to pass along?"`,
      `NOT INTERESTED: [MIRROR] "Not going to be interested?" [pause] "I understand — it's a legal filing. I'd feel bad not giving them a chance."`,
      `SCAM: "Fair — I can text you our company info right now. Would that work?"`
    ]
  }
]

export const CALL_SCRIPTS = {
  intro: INTRO_SCRIPT,
  offer: OFFER_SCRIPT,
  associate: ASSOCIATE_SCRIPT
}

export const CALL_TYPES = Object.keys(CALL_SCRIPTS)

export function getStages(callType) {
  const script = CALL_SCRIPTS[callType]
  if (!script) throw new Error(`Unknown call type: ${callType}`)
  return script.map((section) => ({ id: section.stage, label: section.title }))
}

export function getStageIds(callType) {
  return getStages(callType).map((s) => s.id)
}
