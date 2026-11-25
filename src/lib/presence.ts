import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { openChannel, supabase } from './supabase'

export interface Person {
  key: string
  name: string
  color: string
  /** Può modificare (false = sta solo leggendo). */
  editing: boolean
  self: boolean
}

interface Me {
  name: string
  color: string
  editing: boolean
}

/** Chi ha aperto un documento in questo momento (Supabase Presence), compreso chi legge soltanto. */
export function usePresence(docId: string | undefined, me: Me): Person[] {
  const [people, setPeople] = useState<Person[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const meRef = useRef(me)
  meRef.current = me

  useEffect(() => {
    if (!docId) return
    let cancelled = false
    let channel: RealtimeChannel | null = null
    const key = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random()).slice(2)

    void openChannel(`presence:doc:${docId}`, { config: { presence: { key } } }).then((opened) => {
      if (cancelled) {
        void supabase.removeChannel(opened)
        return
      }
      channel = opened
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = opened.presenceState<Me>()
          const list = Object.entries(state).map(([k, metas]) => {
            const last = metas[metas.length - 1]
            return { key: k, name: last.name, color: last.color, editing: last.editing, self: k === key }
          })
          list.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name))
          setPeople(list)
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channelRef.current = opened
            void opened.track(meRef.current)
          }
        })
    })

    return () => {
      cancelled = true
      channelRef.current = null
      setPeople([])
      if (channel) void supabase.removeChannel(channel)
    }
  }, [docId])

  // Nickname o permessi cambiati: aggiorna quello che vedono gli altri
  useEffect(() => {
    void channelRef.current?.track({ name: me.name, color: me.color, editing: me.editing })
  }, [me.name, me.color, me.editing])

  return people
}
