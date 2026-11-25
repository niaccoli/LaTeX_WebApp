// Crea .env da .env.example al primo avvio, così `npm run dev` funziona senza altri passaggi.
import { copyFileSync, existsSync } from 'node:fs'

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env')
  console.log('Creato .env a partire da .env.example')
}
