// Component-test entry. Loads the SAME stylesheet the app ships — Tailwind resolves through
// the repo's own `postcss.config.js` / `tailwind.config.js`, so a mounted component paints
// with the real `#00719F` / `#00A8E8` tokens, not a bare, unstyled DOM.
import '@/app/globals.css'
