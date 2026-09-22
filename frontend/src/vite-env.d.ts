/// <reference types="vite/client" />

// Pulls in Vite's ambient module declarations — notably the ones that make
// `import crest from './crest.png'` resolve to a string. The landing page
// imports its imagery that way (rather than from `public/`) so the build
// fingerprints and hashes each file; without this reference `tsc --noEmit`
// fails on every asset import.
