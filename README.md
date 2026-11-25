# Appunti LaTeX

Un posto unico dove gli studenti di un corso di laurea raccolgono appunti in LaTeX, organizzati per corso, e li migliorano insieme nel tempo, un po' come una wiki. Non ci sono account né login: chiunque abbia il link può leggere e modificare.

## Cosa fa

- **Corsi e documenti**: si creano, rinominano, riordinano (drag & drop) ed eliminano. Le eliminazioni finiscono in un cestino da cui si recupera tutto.
- **Due modi di organizzare un corso**, da scegliere alla creazione: capitoli separati con preambolo condiviso (predefinito) oppure un unico documento LaTeX completo, con il suo preambolo, come lo scriveresti sul tuo computer.
- **Preambolo condiviso** per corso: `\newcommand`, `\usepackage` e `\newtheorem` scritti lì valgono per tutti i documenti.
- **Editor a due pannelli**: sorgente LaTeX a sinistra (evidenziazione e autocompletamento), PDF a destra compilato da un vero pdfLaTeX che gira nel browser. Il PDF si aggiorna a ogni salvataggio; gli errori compaiono con il numero di riga e portano alla riga giusta.
- **Scrittura simultanea**: più persone scrivono nello stesso documento e vedono i cursori degli altri. In alto si vede chi è presente.
- **Cronologia**: salvataggio automatico a ogni pausa, elenco delle versioni con nickname e data, confronto tra versioni, ripristino con un clic. Si conservano le ultime 5 versioni dell'ultima sessione di lavoro e l'ultima di ciascuna delle 5 sessioni precedenti (una sessione finisce dopo 6 ore senza salvataggi); le altre vengono eliminate in automatico.
- **Immagini**: PNG e JPEG caricati dal pulsante «Immagini», incollati o trascinati nell'editor; si ridimensionano da sole sotto 1 MB, finiscono nello zip e nel PDF.
- **Esportazione e importazione**: ogni documento in `.tex` e PDF, l'intero corso in `.zip` con un `main.tex` che fa `\input` dei singoli file; importazione di un `.tex` esistente, anche completo: il preambolo va nel preambolo del corso e il corpo si divide in un documento per capitolo o sezione (vedi «Preambolo e capitoli»).
- **Ricerca**: corsi per nome o codice, e ricerca nel testo dei documenti di un corso.
- **Protezione dal vandalismo**: limiti per IP su creazione ed eliminazione, tetto alla dimensione dei documenti, codice di modifica facoltativo per corso.

## Avvio in locale

Serve [Node.js](https://nodejs.org) 20 o successivo.

```sh
npm install
npm run dev
```

Poi apri <http://localhost:5173>. Al primo avvio `npm run dev` crea il file `.env` copiando `.env.example`, che punta al progetto Supabase già pronto.

Altri comandi:

| Comando | Cosa fa |
| --- | --- |
| `npm run build` | Controlla i tipi e genera il sito statico in `dist/` |
| `npm run preview` | Serve in locale il contenuto di `dist/` |
| `npm run typecheck` | Solo controllo dei tipi TypeScript |

## Variabili d'ambiente

| Variabile | Significato |
| --- | --- |
| `VITE_SUPABASE_URL` | URL del progetto Supabase, per esempio `https://abc123.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Chiave pubblica del progetto (publishable o anon) |

Sono valori pubblici: finiscono comunque nel JavaScript del sito. La sicurezza non dipende dal tenerli nascosti, ma dalle regole del database (vedi sotto). La chiave `service_role` invece non va mai messa nel frontend, e questo progetto non la usa.

## Usare un proprio progetto Supabase

1. Crea un progetto gratuito su <https://supabase.com>.
2. Nell'SQL Editor esegui `supabase/schema.sql` (tabelle, regole e funzioni).
3. Facoltativo: esegui `supabase/seed.sql` per avere il corso di esempio.
4. Copia URL e chiave pubblica (Project Settings → API) in `.env`.

Non serve altro: Realtime è già attivo sui progetti nuovi e lo schema aggiunge le tabelle giuste alla pubblicazione.

## Deploy gratuito

Il frontend è un sito statico; il backend è Supabase.

**Vercel**

1. Carica il progetto su GitHub e importalo su <https://vercel.com/new>. Vercel riconosce Vite da solo (build `npm run build`, cartella `dist`).
2. In Settings → Environment Variables aggiungi `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Deploy. `vercel.json` fa funzionare gli URL come `/corsi/reti-di-calcolatori/lezione-3` anche aprendoli direttamente.

**Netlify**

1. Importa il repository su <https://app.netlify.com>, con build `npm run build` e cartella `dist`.
2. Aggiungi le stesse due variabili d'ambiente.
3. `public/_redirects` gestisce gli URL diretti.

## Scelte tecniche

**Supabase invece di Node + SQLite.** SQLite richiede un server sempre acceso con disco persistente, che Vercel e Netlify non offrono gratis. Con Supabase il frontend resta statico e si hanno già pronti Postgres, la ricerca full-text e Realtime (presenza, messaggi tra browser, notifiche sulle modifiche).

**Niente account, quindi tutte le scritture passano da funzioni.** Le tabelle sono leggibili da chiunque ma non scrivibili direttamente (Row Level Security). Ogni modifica passa da una funzione Postgres chiamata via RPC (`create_course`, `save_document`, `delete_document`…), che controlla il limite di operazioni per IP, le dimensioni e, per i corsi protetti, il codice di modifica. I limiti sono numeri in `supabase/schema.sql`: 20 corsi, 100 documenti, 40 immagini e 20 eliminazioni all'ora per IP, 1 MB per documento, 1 MB per immagine, 25 MB di immagini per corso.

**Codice di modifica.** Si sceglie solo alla creazione del corso (altrimenti chiunque potrebbe bloccare un corso altrui). Viene salvato come hash; chi non lo ha può leggere. Chi lo inserisce lo ritrova salvato nel proprio browser.

**Sincronizzazione.** Ogni documento aperto è un documento [Yjs](https://yjs.dev) (un CRDT: le modifiche contemporanee si fondono senza sovrascriversi). Gli aggiornamenti viaggiano tra i browser sui canali broadcast di Supabase Realtime; chi ha modifiche locali salva nel database, dopo una pausa nella scrittura, il testo insieme allo stato Yjs. Chi apre il documento parte da quello stato e si allinea con chi è già dentro. Nei corsi protetti il nome del canale contiene una chiave che il server dà solo a chi ha il codice: chi legge soltanto riceve il testo a ogni salvataggio, non tasto per tasto, e non può inviare modifiche.

**Compilazione.** Il PDF è prodotto da pdfLaTeX (TeX Live 2026) compilato in WebAssembly, tramite [`@siglum/engine`](https://github.com/SiglumProject/siglum). Motore e pacchetti si scaricano dal servizio pubblico di Siglum alla prima compilazione e restano nella cache del browser. Ogni documento del sito è solo il corpo (`\section`, testo, formule): prima di compilare gli vengono messi intorno la classe `article`, il preambolo del corso e `\begin{document}`. Un `.tex` che contiene già `\documentclass` viene compilato così com'è.

## Preambolo e capitoli

Alla creazione di un corso si sceglie la struttura: **capitoli separati con preambolo condiviso** (quella descritta qui sotto) oppure **un unico documento LaTeX**. Nel secondo caso il corso nasce con un solo documento completo (`\documentclass`, preambolo e corpo insieme) e senza preambolo condiviso; l'importazione di un `.tex` lo aggiunge così com'è e lo zip contiene i file `.tex` e le immagini nella stessa cartella.

Ogni corso ha un **preambolo condiviso** e un elenco di **documenti**. Il preambolo contiene tutto ciò che sta prima di `\begin{document}` (pacchetti, `\newcommand`, `\newtheorem`); un documento contiene solo il corpo, cioè ciò che sta tra `\begin{document}` e `\end{document}`. Per compilare, il sito mette insieme le due parti.

- **Senza `\documentclass` nel preambolo** il sito usa un'intestazione predefinita: `article` 11pt, A4, `fontenc` T1, `lmodern`, `geometry` con margini di 2,5 cm. Il preambolo aggiunge pacchetti e macro a questa base; `graphicx` viene caricato da solo se serve.
- **Con `\documentclass` nel preambolo** (per esempio `\documentclass[12pt]{report}`) l'intestazione predefinita non si usa: il preambolo è completo e decide classe, opzioni e margini. È il modo più semplice per portare un preambolo che già hai.
- **Importare un `.tex` completo** (con `\documentclass` e `\begin{document}`): il sito propone di dividerlo. Il preambolo diventa quello del corso; il corpo si divide in un documento per ogni `\chapter` (se ce ne sono almeno due) o per ogni `\section`. `\maketitle` e `\tableofcontents` vengono tolti dal corpo perché li genera l'esportazione dell'intero corso. In alternativa si può importare il file così com'è, come documento autonomo con il suo preambolo.
- **Esportazione dell'intero corso**: `main.tex` include il preambolo e fa `\input` dei documenti nell'ordine del sito. Un documento che comincia con `\chapter` o `\section` mantiene la numerazione continua; un testo senza titoli viene introdotto da una «parte» con il nome del documento.
- **Nell'anteprima di un singolo documento** la numerazione riparte da 1 e i riferimenti (`\ref`, `\cite`) ad altri documenti compaiono come `??`: nel PDF dell'intero corso, compilato dallo zip con `pdflatex main.tex` due volte, sono corretti.

## Struttura del progetto

```
src/
  main.tsx                 rotte dell'applicazione
  pages/                   Home, CoursePage, DocumentPage, TrashPage
  components/              LatexEditor (CodeMirror), PdfPreview (pdf.js), HistoryPanel, …
  lib/
    api.ts                 letture e chiamate RPC verso Supabase
    compiler.ts            compilazione LaTeX ed errori leggibili
    collab.ts              sessione Yjs su Supabase Realtime
    presence.ts            chi è nel documento
    export.ts              .tex, PDF, .zip, importazione
supabase/
  schema.sql               schema completo del database
  seed.sql                 corso di esempio
```

## Limiti da conoscere

- **Dipendenza da Siglum.** Se il servizio pubblico di Siglum non è raggiungibile, la prima compilazione su un browser nuovo non parte (chi ha già la cache continua a compilare). Motore e pacchetti si possono ospitare in proprio: vedi la guida «self-hosting» nel repository di Siglum.
- **Piano gratuito di Supabase.** Un progetto senza attività per circa una settimana viene messo in pausa e va riattivato dal pannello di Supabase. Il database gratuito ha 500 MB, condivisi tra testi, cronologia (potata in automatico) e immagini (tetto di 250 MB in tutto).
- **Senza account non c'è identità.** Il nickname è solo un'etichetta: chiunque può sceglierne uno qualsiasi. I limiti per IP frenano il vandalismo ma non lo impediscono; per i corsi a cui si tiene c'è il codice di modifica, e in ogni caso cestino e cronologia permettono di tornare indietro.
- **Una compilazione alla volta mostra un errore alla volta.** pdfLaTeX si ferma al primo errore: corretto quello, al salvataggio successivo compare l'eventuale prossimo.
