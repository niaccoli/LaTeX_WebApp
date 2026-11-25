// Sostituisce 'blake3-wasm/browser.js' (vedi vite.config.ts): l'accelerazione BLAKE3 è
// facoltativa e il compilatore LaTeX ripiega da solo su un hash interno.
throw new Error('BLAKE3 acceleration disabled in this build')
export function hash() {}
