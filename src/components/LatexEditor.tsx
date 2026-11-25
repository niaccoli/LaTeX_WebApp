import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { tags as t } from '@lezer/highlight'

export interface LatexEditorHandle {
  getValue: () => string
  /** Sostituisce tutto il testo (es. ripristino di una versione); resta annullabile con Cmd/Ctrl+Z. */
  setValue: (value: string) => void
  goToLine: (line: number) => void
  /** Sottolinea le righe con errori di compilazione. */
  setErrors: (errors: { line: number | null; message: string }[]) => void
  focus: () => void
  /** Inserisce del testo dove si trova il cursore (sostituendo la selezione). */
  insertText: (text: string) => void
}

interface Props {
  initialValue: string
  readOnly: boolean
  /** Macro e ambienti definiti nel preambolo del corso, proposti nell'autocompletamento. */
  macros?: string[]
  environments?: string[]
  /** Nomi delle immagini del corso, proposti dentro \includegraphics{…}. */
  images?: string[]
  /** Immagini incollate o trascinate nell'editor. */
  onImageFiles?: (files: File[]) => void
  onChange: (value: string) => void
  onSave: () => void
  /** Estensioni aggiuntive fissate alla creazione (es. sincronizzazione in tempo reale). */
  extensions?: Extension[]
}

// ---------- Autocompletamento ----------

const snippet = (label: string, template: string, detail?: string): Completion => snippetCompletion(template, { label, detail, type: 'function' })
const plain = (label: string, detail?: string): Completion => ({ label, detail, type: 'keyword' })

const COMMANDS: Completion[] = [
  snippet('\\section', '\\section{${titolo}}', 'sezione'),
  snippet('\\subsection', '\\subsection{${titolo}}', 'sottosezione'),
  snippet('\\subsubsection', '\\subsubsection{${titolo}}'),
  snippet('\\paragraph', '\\paragraph{${titolo}}'),
  snippet('\\textbf', '\\textbf{${testo}}', 'grassetto'),
  snippet('\\textit', '\\textit{${testo}}', 'corsivo'),
  snippet('\\emph', '\\emph{${testo}}', 'enfasi'),
  snippet('\\texttt', '\\texttt{${testo}}', 'monospazio'),
  snippet('\\underline', '\\underline{${testo}}'),
  snippet('\\text', '\\text{${testo}}', 'testo in formula'),
  snippet('\\frac', '\\frac{${num}}{${den}}', 'frazione'),
  snippet('\\dfrac', '\\dfrac{${num}}{${den}}'),
  snippet('\\sqrt', '\\sqrt{${x}}', 'radice'),
  snippet('\\sum', '\\sum_{${i=1}}^{${n}}', 'sommatoria'),
  snippet('\\prod', '\\prod_{${i=1}}^{${n}}', 'produttoria'),
  snippet('\\int', '\\int_{${a}}^{${b}}', 'integrale'),
  snippet('\\lim', '\\lim_{${n \\to \\infty}}', 'limite'),
  snippet('\\binom', '\\binom{${n}}{${k}}'),
  snippet('\\mathbb', '\\mathbb{${R}}'),
  snippet('\\mathcal', '\\mathcal{${O}}'),
  snippet('\\mathbf', '\\mathbf{${x}}'),
  snippet('\\mathrm', '\\mathrm{${x}}'),
  snippet('\\overline', '\\overline{${x}}'),
  snippet('\\hat', '\\hat{${x}}'),
  snippet('\\vec', '\\vec{${x}}'),
  snippet('\\left(', '\\left( ${} \\right)', 'parentesi adattive'),
  snippet('\\left[', '\\left[ ${} \\right]'),
  // Nei modelli "\{" è una graffa letterale: per scrivere \{ in LaTeX servono due barre
  snippet('\\left\\{', '\\left\\\\{ ${} \\right\\\\}'),
  snippet('\\label', '\\label{${nome}}'),
  snippet('\\ref', '\\ref{${nome}}'),
  snippet('\\eqref', '\\eqref{${nome}}'),
  snippet('\\cite', '\\cite{${chiave}}'),
  snippet('\\footnote', '\\footnote{${testo}}'),
  snippet('\\newcommand', '\\newcommand{\\${nome}}{${definizione}}', 'nuova macro'),
  snippet('\\renewcommand', '\\renewcommand{\\${nome}}{${definizione}}'),
  snippet('\\newtheorem', '\\newtheorem{${ambiente}}{${Titolo}}', 'nuovo ambiente tipo teorema'),
  snippet('\\usepackage', '\\usepackage{${pacchetto}}'),
  snippet('\\includegraphics', '\\includegraphics[width=${0.8}\\textwidth]{${file}}'),
  snippet('\\input', '\\input{${file}}'),
  ...['item', 'hline', 'noindent', 'newpage', 'centering', 'qedhere', 'quad', 'qquad', 'ldots', 'cdots', 'dots'].map((c) => plain('\\' + c)),
  ...[
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho',
    'sigma', 'tau', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Psi', 'Omega',
  ].map((c) => plain('\\' + c, 'lettera greca')),
  ...[
    'leq', 'geq', 'neq', 'approx', 'equiv', 'sim', 'in', 'notin', 'subset', 'subseteq', 'supseteq', 'cup', 'cap', 'setminus',
    'emptyset', 'to', 'mapsto', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'iff', 'implies', 'forall', 'exists', 'neg', 'land',
    'lor', 'infty', 'partial', 'nabla', 'cdot', 'times', 'div', 'pm', 'circ', 'oplus', 'otimes', 'log', 'ln', 'exp', 'sin', 'cos',
    'tan', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'gcd', 'lfloor', 'rfloor', 'lceil', 'rceil', 'langle', 'rangle', 'mid',
    'colon', 'prec', 'succ', 'll', 'gg',
  ].map((c) => plain('\\' + c, 'simbolo')),
]

const ENVIRONMENTS: Record<string, string> = {
  itemize: '\\begin{itemize}\n\t\\item ${}\n\\end{itemize}',
  enumerate: '\\begin{enumerate}\n\t\\item ${}\n\\end{enumerate}',
  description: '\\begin{description}\n\t\\item[${termine}] ${}\n\\end{description}',
  equation: '\\begin{equation}\n\t${}\n\\end{equation}',
  'equation*': '\\begin{equation*}\n\t${}\n\\end{equation*}',
  align: '\\begin{align}\n\t${a} &= ${b} \\\\\n\\end{align}',
  'align*': '\\begin{align*}\n\t${a} &= ${b} \\\\\n\\end{align*}',
  cases: '\\begin{cases}\n\t${a} & \\text{se } ${condizione} \\\\\n\t${b} & \\text{altrimenti}\n\\end{cases}',
  pmatrix: '\\begin{pmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{pmatrix}',
  tabular: '\\begin{tabular}{|${l|c|r}|}\n\t\\hline\n\t${A} & ${B} & ${C} \\\\\n\t\\hline\n\\end{tabular}',
  table: '\\begin{table}[h]\n\t\\centering\n\t${}\n\t\\caption{${didascalia}}\n\\end{table}',
  figure: '\\begin{figure}[h]\n\t\\centering\n\t${}\n\t\\caption{${didascalia}}\n\\end{figure}',
  center: '\\begin{center}\n\t${}\n\\end{center}',
  verbatim: '\\begin{verbatim}\n${}\n\\end{verbatim}',
  proof: '\\begin{proof}\n\t${}\n\\end{proof}',
}

function environmentCompletions(extra: string[]): Completion[] {
  const all: Record<string, string> = { ...ENVIRONMENTS }
  for (const name of extra) all[name] ??= `\\begin{${name}}\n\t\${}\n\\end{${name}}`
  return Object.entries(all).map(([name, template]) => snippetCompletion(template, { label: `\\begin{${name}}`, detail: 'ambiente', type: 'class' }))
}

// ---------- Aspetto ----------

// I colori sono variabili CSS, così l'editor segue il tema chiaro/scuro senza essere ricreato
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--text)', padding: '0.6rem 0' },
  '.cm-line': { padding: '0 0.8rem 0 0.4rem' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-line)', color: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--editor-selection)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-match)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--editor-match)', outline: '1px solid var(--border)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow)' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-text)' },
  '.cm-completionDetail': { opacity: '0.7', fontStyle: 'normal', marginLeft: '0.8em' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-textfield, .cm-button': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', backgroundImage: 'none' },
  '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '2px wavy var(--danger)' },
})

const highlight = HighlightStyle.define([
  { tag: [t.tagName, t.keyword], color: 'var(--tok-command)' },
  { tag: t.atom, color: 'var(--tok-env)' },
  { tag: t.comment, color: 'var(--tok-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: 'var(--tok-math)' },
  { tag: t.number, color: 'var(--tok-number)' },
  { tag: [t.bracket, t.paren, t.squareBracket], color: 'var(--tok-bracket)' },
  { tag: t.variableName, color: 'var(--tok-math)' },
  { tag: t.invalid, color: 'var(--danger)' },
])

export const LatexEditor = forwardRef<LatexEditorHandle, Props>(function LatexEditor(
  { initialValue, readOnly, macros, environments, images, onImageFiles, onChange, onSave, extensions },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const readOnlyConf = useRef(new Compartment())
  // I valori più recenti delle props, letti dalle estensioni create una volta sola
  const latest = useRef({ onChange, onSave, macros, environments, images, onImageFiles })
  latest.current = { onChange, onSave, macros, environments, images, onImageFiles }

  useEffect(() => {
    if (!host.current) return

    const complete = (context: CompletionContext): CompletionResult | null => {
      // Dentro \includegraphics{…} si propongono i nomi delle immagini del corso
      const include = context.matchBefore(/\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{[^}\n]*/)
      if (include) {
        const from = include.from + include.text.lastIndexOf('{') + 1
        const names = latest.current.images ?? []
        if (names.length === 0) return null
        return { from, options: names.map((n) => ({ label: n, type: 'text', detail: 'immagine del corso' })), validFor: /^[^}\n]*$/ }
      }
      const word = context.matchBefore(/\\[A-Za-z*]*(\{[A-Za-z*]*)?/)
      if (!word || (word.from === word.to && !context.explicit)) return null
      const custom = (latest.current.macros ?? []).map((m) => plain(m, 'macro del corso'))
      return {
        from: word.from,
        options: [...custom, ...environmentCompletions(latest.current.environments ?? []), ...COMMANDS],
        validFor: /^\\[A-Za-z*]*(\{[A-Za-z*]*)?$/,
      }
    }

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          // Con la sincronizzazione in tempo reale la cronologia è gestita da quella estensione
          ...(extensions ? [] : [history()]),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          StreamLanguage.define(stex),
          syntaxHighlighting(highlight),
          autocompletion({ override: [complete], icons: false }),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                latest.current.onSave()
                return true
              },
            },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          readOnlyConf.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.domEventHandlers({
            paste(event) {
              const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
              if (files.length === 0 || !latest.current.onImageFiles) return false
              event.preventDefault()
              latest.current.onImageFiles(files)
              return true
            },
            drop(event) {
              const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
              if (files.length === 0 || !latest.current.onImageFiles) return false
              event.preventDefault()
              latest.current.onImageFiles(files)
              return true
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString())
          }),
          EditorView.contentAttributes.of({ 'aria-label': 'Sorgente LaTeX', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
          theme,
          ...(extensions ?? []),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // L'editor si crea una volta per documento: il genitore usa `key` per cambiarlo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlyConf.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    })
  }, [readOnly])

  useImperativeHandle(ref, () => ({
    getValue: () => view.current?.state.doc.toString() ?? '',
    focus: () => view.current?.focus(),
    insertText: (text) => {
      const editor = view.current
      if (!editor) return
      const sel = editor.state.selection.main
      editor.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, scrollIntoView: true })
      editor.focus()
    },
    setValue: (value) => {
      const editor = view.current
      if (!editor) return
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: { anchor: 0 } })
    },
    goToLine: (line) => {
      const editor = view.current
      if (!editor) return
      const target = editor.state.doc.line(Math.min(Math.max(1, line), editor.state.doc.lines))
      editor.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
      editor.focus()
    },
    setErrors: (errors) => {
      const editor = view.current
      if (!editor) return
      const diagnostics: Diagnostic[] = []
      for (const e of errors) {
        if (!e.line || e.line > editor.state.doc.lines) continue
        const line = editor.state.doc.line(e.line)
        // Sottolinea il testo della riga, senza l'indentazione
        const indent = line.text.length - line.text.trimStart().length
        diagnostics.push({ from: line.from + Math.min(indent, line.length), to: line.to, severity: 'error', message: e.message })
      }
      editor.dispatch(setDiagnostics(editor.state, diagnostics))
    },
  }))

  return <div ref={host} className="cm-host" />
})
