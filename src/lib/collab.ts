// Scrittura simultanea: un documento Yjs (CRDT) per ogni documento aperto, sincronizzato
// tra i browser con i messaggi "broadcast" di Supabase Realtime. Il database conserva
// lo stato Yjs (colonna ystate) insieme al testo, così chi apre il documento parte allineato.
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { openChannel, supabase } from './supabase'

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

/** Colore stabile per un nickname (cursore e pallino della presenza). */
export function userColor(name: string): { color: string; colorLight: string } {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  const hue = hash % 360
  return { color: `hsl(${hue} 65% 42%)`, colorLight: `hsl(${hue} 65% 42% / 0.25)` }
}

export interface CollabUser {
  name: string
  color: string
  colorLight: string
}

/** Porta il documento Yjs allo stato salvato sul server. */
function loadInitialState(ydoc: Y.Doc, ytext: Y.Text, initial: { content: string; ystate: string | null }) {
  let hadState = false
  if (initial.ystate) {
    try {
      Y.applyUpdate(ydoc, fromBase64(initial.ystate), 'init')
      hadState = true
    } catch {
      hadState = false
    }
  }
  if (ytext.toString() === initial.content) return
  if (!hadState && ytext.length === 0) {
    // Nessuno stato salvato (documento appena creato o importato): lo stato iniziale viene
    // generato in modo identico da tutti i client (stesso clientID), così se due persone
    // aprono il documento nello stesso momento il testo non viene duplicato.
    const seed = new Y.Doc()
    seed.clientID = 1
    seed.getText('content').insert(0, initial.content)
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seed), 'init')
    seed.destroy()
  } else {
    // Stato e testo non coincidono (non dovrebbe succedere): vince il testo salvato
    ydoc.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, initial.content)
    }, 'init')
  }
}

export class DocSession {
  readonly ydoc = new Y.Doc()
  readonly ytext = this.ydoc.getText('content')
  readonly awareness = new Awareness(this.ydoc)
  readonly undoManager: Y.UndoManager
  /** Vero mentre si applica una modifica arrivata da un'altra persona. */
  applyingRemote = false

  private channel: RealtimeChannel | null = null
  private joined = false
  private destroyed = false
  private pendingUpdates: Uint8Array[] = []
  private updateTimer: ReturnType<typeof setTimeout> | undefined
  private pendingAwareness = new Set<number>()
  private awarenessTimer: ReturnType<typeof setTimeout> | undefined

  private constructor(
    readonly docId: string,
    initial: { content: string; ystate: string | null },
    user: CollabUser,
  ) {
    loadInitialState(this.ydoc, this.ytext, initial)
    this.undoManager = new Y.UndoManager(this.ytext)
    this.awareness.setLocalStateField('user', user)
    this.ydoc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    window.addEventListener('pagehide', this.sayGoodbye)
  }

  /** `channelKey` è la chiave segreta del canale per i corsi protetti da codice. */
  static async open(docId: string, initial: { content: string; ystate: string | null }, user: CollabUser, channelKey: string | null): Promise<DocSession> {
    const session = new DocSession(docId, initial, user)
    const channel = await openChannel(`doc:${docId}${channelKey ? `:${channelKey}` : ''}`, { config: { broadcast: { self: false } } })
    session.channel = channel
    channel
      .on('broadcast', { event: 'u' }, ({ payload }) => session.receiveUpdate(payload.d))
      .on('broadcast', { event: 'sv' }, ({ payload }) => session.answerSync(payload.d, payload.r === true))
      .on('broadcast', { event: 'aw' }, ({ payload }) => {
        if (!session.destroyed) applyAwarenessUpdate(session.awareness, fromBase64(payload.d), 'remote')
      })
      .subscribe((status) => {
        session.joined = status === 'SUBSCRIBED'
        // A ogni (ri)connessione ci si riallinea con chi è già nel documento
        if (session.joined) session.announce(false)
      })
    return session
  }

  /** Stato completo da salvare nel database insieme al testo. */
  encodeState(): string {
    return toBase64(Y.encodeStateAsUpdate(this.ydoc))
  }

  setUser(user: CollabUser) {
    this.awareness.setLocalStateField('user', user)
  }

  destroy() {
    if (this.destroyed) return
    this.flushUpdates()
    this.sayGoodbye()
    this.destroyed = true
    clearTimeout(this.updateTimer)
    clearTimeout(this.awarenessTimer)
    window.removeEventListener('pagehide', this.sayGoodbye)
    this.ydoc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    if (this.channel) void supabase.removeChannel(this.channel)
    this.awareness.destroy()
    this.undoManager.destroy()
    this.ydoc.destroy()
  }

  // ---------- Invio ----------

  private send(event: string, payload: Record<string, unknown>) {
    if (!this.joined || this.destroyed || !this.channel) return
    void this.channel.send({ type: 'broadcast', event, payload })
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote' || origin === 'init') return
    // Raggruppa le modifiche ravvicinate in un solo messaggio
    this.pendingUpdates.push(update)
    this.updateTimer ??= setTimeout(this.flushUpdates, 60)
  }

  private flushUpdates = () => {
    clearTimeout(this.updateTimer)
    this.updateTimer = undefined
    if (this.pendingUpdates.length === 0) return
    const merged = this.pendingUpdates.length === 1 ? this.pendingUpdates[0] : Y.mergeUpdates(this.pendingUpdates)
    this.pendingUpdates = []
    this.send('u', { d: toBase64(merged) })
  }

  private onAwarenessUpdate = (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === 'remote') return
    for (const id of [...changes.added, ...changes.updated, ...changes.removed]) this.pendingAwareness.add(id)
    this.awarenessTimer ??= setTimeout(this.flushAwareness, 80)
  }

  private flushAwareness = () => {
    clearTimeout(this.awarenessTimer)
    this.awarenessTimer = undefined
    if (this.pendingAwareness.size === 0) return
    const ids = [...this.pendingAwareness]
    this.pendingAwareness.clear()
    this.send('aw', { d: toBase64(encodeAwarenessUpdate(this.awareness, ids)) })
  }

  /** Dice agli altri cosa abbiamo già; `isReply` evita che due client si rispondano all'infinito. */
  private announce(isReply: boolean) {
    this.send('sv', { d: toBase64(Y.encodeStateVector(this.ydoc)), r: isReply })
    this.send('aw', { d: toBase64(encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID])) })
  }

  private sayGoodbye = () => {
    if (this.destroyed) return
    removeAwarenessStates(this.awareness, [this.ydoc.clientID], 'leave')
    this.flushAwareness()
  }

  // ---------- Ricezione ----------

  private receiveUpdate(data: string) {
    if (this.destroyed) return
    this.applyingRemote = true
    try {
      Y.applyUpdate(this.ydoc, fromBase64(data), 'remote')
    } finally {
      this.applyingRemote = false
    }
  }

  /** Un altro client ha annunciato il suo stato: gli mandiamo quello che gli manca. */
  private answerSync(stateVector: string, isReply: boolean) {
    if (this.destroyed) return
    const diff = Y.encodeStateAsUpdate(this.ydoc, fromBase64(stateVector))
    if (diff.length > 2) this.send('u', { d: toBase64(diff) })
    if (!isReply) this.announce(true)
  }
}
