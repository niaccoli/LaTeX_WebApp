// Importazione di un .tex completo: separa il preambolo dal corpo e, se ci sono
// più capitoli o sezioni, divide il corpo in un documento per ciascuno.

export interface TexPart {
  title: string
  content: string
}

export interface ParsedTex {
  /** Tutto ciò che precede \begin{document}, \documentclass compreso. */
  preamble: string
  /** Il corpo, senza \maketitle e \tableofcontents (li genera l'esportazione del corso). */
  body: string
  documentClass: string
  /** Livello usato per dividere il corpo; null se non c'è nulla da dividere. */
  level: 'chapter' | 'section' | null
  parts: TexPart[]
}

/** Sostituisce i commenti con spazi (stessa lunghezza): le ricerche non li vedono e le posizioni restano valide. */
function maskComments(text: string): string {
  return text.replace(/(^|[^\\])%[^\n]*/gm, (m: string, pre: string) => pre + ' '.repeat(m.length - pre.length))
}

/** Come sopra per gli ambienti dove un \section scritto non è un vero titolo. */
function maskVerbatim(text: string): string {
  return text.replace(/\\begin\{(verbatim\*?|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** Contenuto del gruppo { … } che si apre in `openIndex`, con le graffe annidate. */
function braceArg(text: string, openIndex: number): string {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(openIndex + 1, i)
  }
  return text.slice(openIndex + 1, openIndex + 80)
}

function cleanTitle(raw: string): string {
  const title = raw
    .replace(/\\(?:label|index)\{[^}]*\}/g, '')
    .replace(/\\[A-Za-z]+\*?\s*/g, '')
    .replace(/[{}$]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return title.slice(0, 200) || 'Senza titolo'
}

const heading = (name: 'chapter' | 'section') => new RegExp(`^[ \\t]*\\\\${name}\\*?[ \\t]*(?:\\[[^\\]]*\\])?[ \\t]*\\{`, 'gm')

/** True se il testo, tolti commenti e spazi, è vuoto. */
export function isBlankTex(text: string): boolean {
  return maskComments(text).trim() === ''
}

/** Analizza un documento LaTeX completo; restituisce null se non lo è (manca \documentclass o \begin{document}). */
export function parseFullTex(source: string): ParsedTex | null {
  const masked = maskComments(source)
  const begin = masked.indexOf('\\begin{document}')
  if (begin < 0) return null
  const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(masked.slice(0, begin))
  if (!cls) return null

  const bodyStart = begin + '\\begin{document}'.length
  const end = masked.lastIndexOf('\\end{document}')
  const raw = source.slice(bodyStart, end > bodyStart ? end : undefined)
  const preamble = source.slice(0, begin).trimEnd() + '\n'
  const body =
    raw
      .replace(/^[ \t]*\\(?:maketitle|tableofcontents)[ \t]*(?:%.*)?$\n?/gm, '')
      .replace(/^\s+/, '')
      .trimEnd() + '\n'

  const maskedBody = maskVerbatim(maskComments(body))
  const chapters = [...maskedBody.matchAll(heading('chapter'))]
  const sections = [...maskedBody.matchAll(heading('section'))]
  const level = chapters.length >= 2 ? 'chapter' : sections.length >= 2 ? 'section' : null
  const marks = level === 'chapter' ? chapters : level === 'section' ? sections : []

  const parts: TexPart[] = []
  if (level) {
    const starts = marks.map((m) => m.index as number)
    marks.forEach((m, i) => {
      const to = i + 1 < starts.length ? starts[i + 1] : body.length
      const open = starts[i] + m[0].length - 1
      parts.push({ title: cleanTitle(braceArg(body, open)), content: body.slice(starts[i], to).trimEnd() + '\n' })
    })
    // Quello che precede il primo titolo: un documento a sé se ha del testo, altrimenti resta unito al primo
    const intro = body.slice(0, starts[0]).trim()
    if (intro) {
      const onlyCommands = intro.replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, '').trim() === ''
      if (onlyCommands) parts[0] = { ...parts[0], content: intro + '\n' + parts[0].content }
      else parts.unshift({ title: 'Introduzione', content: intro + '\n' })
    }
  }
  return { preamble, body, documentClass: cls[1].trim(), level, parts }
}
