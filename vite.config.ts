import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Su GitHub Pages il sito sta in una sottocartella (/nome-repo/): la pubblicazione imposta VITE_BASE
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { port: 5173, strictPort: true, allowedHosts: ['.trycloudflare.com', '.ts.net'] },
  // Impostazioni richieste dal compilatore LaTeX (@siglum/engine) con Vite
  resolve: {
    alias: {
      // Dipendenza facoltativa che Vite non riesce a impacchettare: il motore ha un ripiego interno
      'blake3-wasm/browser.js': fileURLToPath(new URL('./blake3-disabled.js', import.meta.url)),
    },
    dedupe: ['@siglum/filesystem'],
  },
  build: { target: 'esnext' },
  define: { global: 'globalThis' },
})
