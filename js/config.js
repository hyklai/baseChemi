// config.js — the only file you need to edit.
//
// Paste the config object from the Firebase console:
//   Project settings -> General -> Your apps -> Web app -> SDK setup -> Config
//
// These values are not secrets. They ship in every Firebase web app and are
// visible in your public repo by design. Access is controlled by the rules in
// database.rules.json, not by hiding these keys.

export const firebaseConfig = {
  apiKey: "AIzaSyAWj8e3PX-aYwzctJe3RT2VwyjYjtkopfI",
  authDomain: "basechemi.firebaseapp.com",
  databaseURL: "https://basechemi-default-rtdb.firebaseio.com",
  projectId: "basechemi",
  storageBucket: "basechemi.firebasestorage.app",
  messagingSenderId: "626297178507",
  appId: "1:626297178507:web:1a3741d34be0b4d547878e"
};

// Questions on the projector stay blank until this many students have tried
// them. Prevents a red cell in a small section from pointing at one person.
export const MIN_RESPONSES_TO_SHOW = 5;

// Loaded on the teacher screen's "Load topic" menu.
export const BUILTIN_TOPICS = [
  { file: "topics/stoichiometry.json", label: "Stoichiometry & Limiting Reagents" },
  { file: "topics/mole-ladder.json", label: "8-31-2026" },
  { file: "topics/chapter02-03.json", label: "9-03-2026" }
];
