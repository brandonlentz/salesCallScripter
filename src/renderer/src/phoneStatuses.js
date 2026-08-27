// Call-outcome tag for a single number — set after a dial attempt so the
// next rep to work this property (or you, next round) knows what happened
// last time without re-reading notes. Purely informational, doesn't affect
// dialing or the suggestion engine. Shared between PropertyPanel.jsx (the
// property record's own phone list) and LiveCallPanel.jsx's full-screen
// Start Call prompt (dispositioning the number you just dialed).
export const PHONE_STATUSES = [
  { value: '', label: 'No status', icon: '' },
  { value: 'correct', label: 'Correct', icon: '✅' },
  { value: 'wrong', label: 'Wrong number', icon: '❌' },
  { value: 'no-answer', label: 'No answer', icon: '📵' },
  { value: 'dnc', label: 'DNC', icon: '🚫' },
  { value: 'dead', label: 'Dead', icon: '💀' }
]
