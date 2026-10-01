// Local <-> REISift phone-status enum mapping, shared by both sync
// directions — properties.js's inbound mapReisiftOwnerToContact/mergePhone,
// and reisiftOutbound.js's outbound notifyPhoneDispositioned — so the two
// never drift apart. REISift's enum is confirmed two ways: the field
// picker on its "Add Phone Status to Phones" Zapier action, and real
// inbound webhook payloads (owner.phones[].status). This app's own values
// (phoneStatuses.js's PHONE_STATUSES) are lowercase/hyphenated for its UI.
const REISIFT_STATUS_BY_LOCAL_STATUS = {
  '': 'UNKNOWN',
  correct: 'CORRECT',
  wrong: 'WRONG',
  'no-answer': 'NO_ANSWER',
  dnc: 'DNC',
  dead: 'DEAD'
}

// REISift's CORRECT_DNC/WRONG_DNC (correctness + DNC combined) have no
// distinct local status — this app treats DNC as its own exclusive status
// — so both collapse to 'dnc' inbound (the compliance-relevant half wins).
const LOCAL_STATUS_BY_REISIFT_STATUS = {
  UNKNOWN: '',
  CORRECT: 'correct',
  CORRECT_DNC: 'dnc',
  WRONG: 'wrong',
  WRONG_DNC: 'dnc',
  NO_ANSWER: 'no-answer',
  DEAD: 'dead',
  DNC: 'dnc'
}

export function toReisiftPhoneStatus(localStatus) {
  return REISIFT_STATUS_BY_LOCAL_STATUS[localStatus] ?? 'UNKNOWN'
}

export function fromReisiftPhoneStatus(reisiftStatus) {
  return LOCAL_STATUS_BY_REISIFT_STATUS[reisiftStatus] ?? ''
}
