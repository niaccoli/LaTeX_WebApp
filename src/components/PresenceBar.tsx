import type { Person } from '../lib/presence'

const MAX_SHOWN = 5

/** Pallini con le iniziali di chi ha aperto il documento adesso. */
export function PresenceBar({ people }: { people: Person[] }) {
  if (people.length === 0) return null
  const shown = people.slice(0, MAX_SHOWN)
  const describe = (p: Person) => `${p.name}${p.self ? ' (tu)' : ''}${p.editing ? '' : ' · sta leggendo'}`
  const summary =
    people.length === 1 ? 'Ci sei solo tu in questo documento' : `${people.length} persone in questo documento: ${people.map(describe).join(', ')}`

  return (
    <div className="presence" role="group" aria-label={summary} title={summary}>
      {shown.map((p) => (
        <span key={p.key} className={p.editing ? 'presence-dot' : 'presence-dot presence-reading'} style={{ background: p.color }} title={describe(p)}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {people.length > MAX_SHOWN && <span className="presence-dot presence-more">+{people.length - MAX_SHOWN}</span>}
    </div>
  )
}
