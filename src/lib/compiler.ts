// Compilazione LaTeX vera nel browser (pdfLaTeX in WebAssembly) con Siglum.
// Il motore e i pacchetti TeX vengono scaricati dal servizio pubblico di Siglum
// alla prima compilazione e poi restano nella cache del browser.
import { SiglumCompiler, resolveRuntime } from '@siglum/engine'
import workerUrl from '@siglum/engine/worker?url'

export interface LatexError {
  /** Riga nel sorgente indicato da `where`; null se TeX non l'ha indicata. */
  line: number | null
  where: 'doc' | 'preamble' | 'other'
  message: string
}

export interface CompileOutput {
  pdf: Uint8Array | null
  errors: { line: number | null; message: string }[]
  log: string
}

interface EngineResult {
  success: boolean
  pdf?: Uint8Array
  log?: string
  error?: string
}

let enginePromise: Promise<SiglumCompiler> | null = null
let statusListener: ((note: string) => void) | null = null

function getEngine(): Promise<SiglumCompiler> {
  if (!enginePromise) {
    enginePromise = (async () => {
      statusListener?.('Scarico il compilatore (solo la prima volta)…')
      const runtime = await resolveRuntime()
      const compiler = new SiglumCompiler({
        ...runtime,
        workerUrl,
        onProgress: (stage: string) => statusListener?.(progressLabel(stage)),
      })
      await compiler.init()
      return compiler
    })()
    // Se il caricamento fallisce (rete assente), il prossimo tentativo riparte da capo
    enginePromise.catch(() => {
      enginePromise = null
    })
  }
  return enginePromise
}

function progressLabel(stage: string): string {
  const s = String(stage).toLowerCase()
  if (s.includes('wasm') || s.includes('bundle') || s.includes('download') || s.includes('load') || s.includes('init')) {
    return 'Scarico il compilatore e i pacchetti…'
  }
  if (s.includes('ctan') || s.includes('package') || s.includes('fetch')) return 'Scarico i pacchetti LaTeX…'
  return 'Compilazione…'
}

/** Compila un sorgente completo (con \documentclass). Non lancia per errori LaTeX: li restituisce. */
export async function compileLatex(
  source: string,
  onStatus?: (note: string) => void,
  files: Record<string, Uint8Array> = {},
): Promise<CompileOutput> {
  statusListener = onStatus ?? null
  let engine: SiglumCompiler
  try {
    engine = await getEngine()
  } catch (e) {
    throw new Error(
      'Non riesco a caricare il compilatore LaTeX. Controlla la connessione e riprova. (' + (e instanceof Error ? e.message : String(e)) + ')',
    )
  }
  onStatus?.('Compilazione…')
  // Con file aggiuntivi (le immagini) il motore non può riusare il preambolo già elaborato: li passa solo chi serve
  const options = Object.keys(files).length > 0 ? { engine: 'pdflatex', additionalFiles: files } : { engine: 'pdflatex' }
  const result = (await engine.compile(source, options)) as EngineResult
  const log = result.log ?? ''
  const errors = parseErrors(log, result.success ? undefined : result.error)
  if (!result.success && errors.length === 0) errors.push({ line: null, message: result.error || 'Compilazione non riuscita.' })
  return { pdf: result.success && result.pdf ? new Uint8Array(result.pdf) : null, errors, log }
}

// ---------- Errori leggibili ----------

/** Estrae gli errori dal log di TeX, con il numero di riga quando c'è. */
export function parseErrors(log: string, error?: string): { line: number | null; message: string }[] {
  const out: { line: number | null; message: string }[] = []
  const seen = new Set<string>()
  const push = (line: number | null, message: string) => {
    const key = `${line}|${message}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ line, message })
  }
  const lines = `${log}\n${error ?? ''}`.split('\n')

  // Riga con il contesto dell'errore: "l.12 testo \comando"
  const context = (from: number): { line: number | null; text: string } => {
    for (let j = from; j < Math.min(lines.length, from + 14); j++) {
      const m = /^l\.(\d+) ?(.*)$/.exec(lines[j])
      if (m) return { line: Number(m[1]), text: m[2] }
    }
    return { line: null, text: '' }
  }

  for (let i = 0; i < lines.length; i++) {
    const fileLine = /^(?:\.\/|\/)?[^\s:]*\.tex:(\d+): (.+)$/.exec(lines[i])
    if (fileLine) {
      push(Number(fileLine[1]), humanize(fileLine[2], context(i + 1).text))
      continue
    }
    if (lines[i].startsWith('! ')) {
      const ctx = context(i + 1)
      push(ctx.line, humanize(lines[i].slice(2), ctx.text))
    }
  }
  if (out.length === 0 && error) push(null, error)

  // Toglie il rumore: righe di riepilogo e doppioni generici dello stesso errore
  const specific = out.filter((e) => {
    if (/^==>|Fatal error occurred|^Compilazione interrotta/.test(e.message)) return false
    if (e.message === 'Comando non definito.' && out.some((o) => o.line === e.line && o.message.startsWith('Comando non definito:'))) return false
    return true
  })
  return (specific.length > 0 ? specific : out).slice(0, 25)
}

function humanize(message: string, contextText: string): string {
  const msg = message.trim()
  if (/^Undefined control sequence/.test(msg)) {
    const cmd = /(\\[A-Za-z@]+|\\.)\s*$/.exec(contextText)
    return cmd ? `Comando non definito: ${cmd[1]}` : 'Comando non definito.'
  }
  let m = /Environment (.+?) undefined/.exec(msg)
  if (m) return `Ambiente non definito: ${m[1]}`
  m = /File [`'"]?([^'"`]+?)['"]? not found/.exec(msg)
  if (m && /\.(png|jpe?g)$/i.test(m[1])) return `Immagine non trovata: ${m[1]}. Caricala dal pulsante «Immagini» e usa il suo nome.`
  if (m) return `File o pacchetto non trovato: ${m[1]}`
  if (/^Missing \$ inserted/.test(msg)) return 'Manca un $: un simbolo matematico è fuori da una formula, o una formula non è chiusa.'
  m = /\\begin\{(.+?)\} on input line (\d+) ended by \\end\{(.+?)\}/.exec(msg)
  if (m) return `\\begin{${m[1]}} (riga ${m[2]}) chiuso da \\end{${m[3]}}.`
  if (/^Missing \} inserted|^Missing \{ inserted|^Extra \}/.test(msg)) return `Parentesi graffe non bilanciate (${msg})`
  if (/^Emergency stop/.test(msg)) return 'Compilazione interrotta.'
  return msg.replace(/^LaTeX Error: /, '').replace(/^Package (\S+) Error: /, '[$1] ')
}

// ---------- Costruzione del sorgente ----------

const HEAD = ['\\documentclass[11pt,a4paper]{article}', '\\usepackage[T1]{fontenc}', '\\usepackage{lmodern}', '\\usepackage[a4paper,margin=2.5cm]{geometry}']

/** Se il preambolo carica già geometry (con le sue opzioni), l'intestazione predefinita non lo carica: darebbe «Option clash». */
export const headFor = (preamble: string): string[] =>
  /^[^%\n]*\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bgeometry\b[^}]*\}/m.test(preamble) ? HEAD.filter((l) => !l.includes('{geometry}')) : HEAD

/** True se il testo imposta una propria classe di documento (\documentclass non commentato). */
export const hasDocumentClass = (text: string) => /^[^%\n]*\\documentclass/m.test(text)

const FONT_NAMES = /\b(lmodern|cm-super|libertine|libertinus|mathpazo|palatino|newtxtext|newtxmath|newpxtext|newpxmath|times|mathptmx|helvet|charter|bookman|kpfonts|fourier|stix2?|tgtermes|tgpagella|tgheros|fontspec|inconsolata|sourcecodepro|beramono|roboto|lato)\b/

/** Vero se un \usepackage (non commentato) carica già un pacchetto di font. */
const hasFontPackage = (text: string) =>
  text.split('\n').some((l) => /^[^%]*\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\}/.test(l) && FONT_NAMES.test(l.replace(/%.*/, '').replace(/^.*\\usepackage\s*(\[[^\]]*\])?/, '')))

/**
 * Il compilatore nel browser non ha i font bitmap della codifica T1: con \usepackage[T1]{fontenc} senza un
 * pacchetto di font (es. \texttt o verbatim) darebbe «Font ectt1200 not found». Come su una normale installazione
 * di TeX, si aggiunge lmodern, che ha gli stessi caratteri in versione vettoriale.
 */
export const fontFix = (preamble: string): string[] =>
  /fontenc/.test(preamble) && !hasFontPackage(preamble) ? ['\\usepackage{lmodern}'] : []

export interface BuiltSource {
  source: string
  /** Riporta una riga del sorgente compilato alla riga del documento o del preambolo. */
  locate: (e: { line: number | null; message: string }) => LatexError
}

/**
 * Un documento del sito è solo il corpo (\section, testo, formule): qui gli si mette intorno
 * la classe, il preambolo del corso e \begin{document}. Tutto sta in un solo file, così il
 * compilatore può riusare il preambolo già elaborato; i numeri di riga si ricalcolano con `locate`.
 */
export function buildSource(content: string, preamble: string, kind: 'doc' | 'preamble', offset?: { chapter: number; section: number }): BuiltSource {
  // Un .tex importato già completo si compila così com'è
  if (kind === 'doc' && /^[^%\n]*\\documentclass/m.test(content)) {
    // Nel browser mancano i font bitmap di Computer Modern (es. «Font tcrm1000 not found» con textcomp):
    // senza pacchetti di font si aggiunge lmodern sulla stessa riga di \begin{document}, così le righe non si spostano
    const source = hasFontPackage(content) ? content : content.replace(/^([^%\n]*)\\begin\{document\}/m, '$1\\usepackage{lmodern}\\begin{document}')
    return { source, locate: (e) => ({ ...e, where: e.line ? 'doc' : 'other' }) }
  }

  if (kind === 'preamble') {
    // Se il preambolo ha una sua \documentclass, sostituisce l'impostazione predefinita
    const lead = hasDocumentClass(content) ? [] : headFor(content)
    const fix = lead.length === 0 ? fontFix(content) : []
    const source = [...lead, content, ...fix, '\\begin{document}', 'Il preambolo compila correttamente.', '\\end{document}'].join('\n')
    const count = content.split('\n').length
    return {
      source,
      locate: (e) => {
        const line = e.line === null ? null : e.line - lead.length
        return line !== null && line >= 1 && line <= count ? { ...e, line, where: 'doc' } : { ...e, line: null, where: 'other' }
      },
    }
  }

  // \includegraphics: se il preambolo del corso non carica già graphicx, lo si aggiunge qui
  // Se il preambolo del corso ha la sua \documentclass, l'intestazione predefinita (article 11pt A4…) non si usa
  const ownClass = hasDocumentClass(preamble)
  const needsGraphicx = !/graphicx/.test(preamble)
  const base = headFor(preamble)
  const head = ownClass ? [] : needsGraphicx ? [...base, '\\usepackage{graphicx}'] : base
  const tail = ownClass ? [...(needsGraphicx ? ['\\usepackage{graphicx}'] : []), ...fontFix(preamble)] : []
  const preambleLines = preamble.split('\n').length
  // Numerazione del PDF completo: i contatori partono dopo i titoli dei documenti precedenti (sulla stessa riga, senza spostare le righe)
  const counters =
    (offset?.chapter ? `\\setcounter{chapter}{${offset.chapter}}` : '') + (offset?.section ? `\\setcounter{section}{${offset.section}}` : '')
  const source = [...head, preamble, ...tail, '\\begin{document}' + counters, content, '\\end{document}'].join('\n')
  const docStart = head.length + preambleLines + tail.length + 1 // righe prima della prima riga del documento
  const docLines = content.split('\n').length
  return {
    source,
    locate: (e) => {
      if (e.line === null) return { ...e, where: 'other' }
      if (e.line > docStart && e.line <= docStart + docLines) return { ...e, line: e.line - docStart, where: 'doc' }
      if (e.line > head.length && e.line <= head.length + preambleLines) return { ...e, line: e.line - head.length, where: 'preamble' }
      return { ...e, line: null, where: 'other' }
    },
  }
}

/** Nomi delle macro definite nel preambolo, per l'autocompletamento. */
export function extractMacros(preamble: string): string[] {
  const names = new Set<string>()
  const re = /\\(?:re)?newcommand\*?\s*\{?\s*(\\[A-Za-z@]+)|\\DeclareMathOperator\*?\s*\{?\s*(\\[A-Za-z@]+)|\\def\s*(\\[A-Za-z@]+)/g
  for (const m of preamble.matchAll(re)) names.add(m[1] ?? m[2] ?? m[3])
  return [...names]
}

/** Nomi degli ambienti definiti con \newtheorem nel preambolo. */
export function extractEnvironments(preamble: string): string[] {
  const names = new Set<string>()
  for (const m of preamble.matchAll(/\\newtheorem\*?\s*\{([A-Za-z*]+)\}/g)) names.add(m[1])
  return [...names]
}
