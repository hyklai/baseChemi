// config.js — the only file you need to edit.
//
// Paste the config object from the Firebase console:
//   Project settings -> General -> Your apps -> Web app -> SDK setup -> Config
//
// These values are not secrets. They ship in every Firebase web app and are
// visible in your public repo by design. Access is controlled by the rules in
// database.rules.json, not by hiding these keys.

export const firebaseConfig = {
  apiKey: "PASTE_YOURS",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000",
};

// Questions on the projector stay blank until this many students have tried
// them. Prevents a red cell in a small section from pointing at one person.
export const MIN_RESPONSES_TO_SHOW = 5;

// The "Load topic" menu on the teacher screen and the answer bench.
// Add one line per topic file in topics/.
//
// Both screens re-read this file with a cache-busting query on every load, so a
// topic you add here appears as soon as GitHub Pages finishes deploying. If it
// still does not show, the deploy has not landed yet: check the Actions tab.
export const BUILTIN_TOPICS = [
  { file: "topics/stoichiometry.json", label: "Stoichiometry & Limiting Reagents" },
  { file: "topics/mole-ladder.json", label: "8-31-2026" },
];

// Makes the question text on the student screen unselectable, so it cannot be
// dragged, right-clicked, long-pressed or Ctrl+C'd into a chatbot. The answer
// box stays fully editable.
//
// Read the "What this does not stop" note in the README before relying on it.
// A screenshot defeats all of this in about three seconds, and the answer key
// is in the browser regardless.
export const LOCK_QUESTION_TEXT = true;

// Also refuses pastes into the answer box. Off by default, because it blocks
// legitimate pasting from a calculator app as much as anything else.
export const BLOCK_ANSWER_PASTE = false;
