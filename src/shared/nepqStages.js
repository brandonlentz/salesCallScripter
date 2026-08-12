// The 8 stages of Jeremy Miner's NEPQ (Neuro-Emotional Persuasion Questioning)
// framework, as applied to Pickle Deeds' two call types. Single source of
// truth shared by the renderer (stage tracker UI) and the main process
// (suggestion engine prompt) so they can't drift apart.
export const NEPQ_STAGES = [
  {
    id: 'connection',
    label: 'Connection',
    description: 'Build rapport, avoid triggering seller resistance.'
  },
  {
    id: 'situation',
    label: 'Situation',
    description: 'Understand the property and title situation.'
  },
  {
    id: 'problem-awareness',
    label: 'Problem Awareness',
    description: 'Surface the real pain of having a stuck property.'
  },
  {
    id: 'solution-awareness',
    label: 'Solution Awareness',
    description: 'Explore what it would mean to resolve it.'
  },
  {
    id: 'consequence',
    label: 'Consequence',
    description: 'Cost of inaction — ongoing taxes, family conflict, property sitting.'
  },
  {
    id: 'qualifying',
    label: 'Qualifying',
    description: 'Confirm motivation, decision authority, timeline.'
  },
  {
    id: 'transition',
    label: 'Transition to Presentation',
    description: 'Set up the offer.'
  },
  {
    id: 'commitment',
    label: 'Commitment',
    description: 'Gain agreement without pressure.'
  }
]

export const NEPQ_STAGE_IDS = NEPQ_STAGES.map((stage) => stage.id)
