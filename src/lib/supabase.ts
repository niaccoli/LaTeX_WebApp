import { createClient, type RealtimeChannel, type RealtimeChannelOptions } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Mancano VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY: copia .env.example in .env e compilalo.')
}

// Accesso con account (email e password): la sessione resta salvata nel browser e si rinnova da sola.
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 20 } },
})

/**
 * Apre un canale Realtime. Se ne esiste ancora uno con lo stesso nome in chiusura
 * (succede quando un componente viene smontato e rimontato subito), aspetta che sparisca:
 * altrimenti il client riuserebbe quello vecchio, che sta per essere chiuso.
 */
export async function openChannel(name: string, options?: RealtimeChannelOptions): Promise<RealtimeChannel> {
  const topic = `realtime:${name}`
  for (let i = 0; i < 40 && supabase.getChannels().some((c) => c.topic === topic); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return supabase.channel(name, options)
}
