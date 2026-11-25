-- Corso di esempio: «Algoritmi e Strutture Dati» con preambolo e tre lezioni.
-- Si può eseguire più volte: se il corso esiste già non fa nulla.
do $seed$
declare cid uuid;
begin
  if exists (select 1 from public.courses where slug = 'algoritmi-e-strutture-dati') then return; end if;
  insert into public.courses (slug, name, code, academic_year, description)
  values ('algoritmi-e-strutture-dati', 'Algoritmi e Strutture Dati', 'ASD', '2026/27',
          'Corso di esempio: notazione asintotica, ricorrenze e algoritmi di ordinamento.')
  returning id into cid;

  insert into public.documents (course_id, kind, slug, title, position, content, updated_by) values
  (cid, 'preamble', 'preambolo', 'Preambolo', 0, $tex$% Macro e pacchetti condivisi da tutti i documenti del corso
\usepackage{amsmath, amssymb, amsthm}

\newtheorem{theorem}{Teorema}
\newtheorem{lemma}{Lemma}
\newtheorem{definition}{Definizione}
\newtheorem{example}{Esempio}

\newcommand{\N}{\mathbb{N}}
\newcommand{\R}{\mathbb{R}}
\newcommand{\bigO}{\mathcal{O}}
\newcommand{\floor}[1]{\left\lfloor #1 \right\rfloor}
\newcommand{\ceil}[1]{\left\lceil #1 \right\rceil}
$tex$, 'esempio'),

  (cid, 'doc', 'lezione-1-notazione-asintotica', 'Lezione 1 – Notazione asintotica', 1, $tex$\section{Perché la notazione asintotica}

Il tempo di esecuzione di un algoritmo dipende dalla macchina, dal linguaggio e dall'input. Per confrontare due algoritmi ci interessa solo \textbf{come cresce} il costo al crescere della dimensione $n$ dell'input, ignorando costanti moltiplicative e termini di ordine inferiore.

\section{Definizioni}

\begin{definition}[O grande]
Siano $f, g \colon \N \to \R^{+}$. Diciamo che $f(n) = \bigO(g(n))$ se esistono $c > 0$ e $n_0 \in \N$ tali che
\[
  f(n) \le c \cdot g(n) \qquad \text{per ogni } n \ge n_0 .
\]
\end{definition}

\begin{definition}[Omega e Theta]
$f(n) = \Omega(g(n))$ se esistono $c > 0$ e $n_0$ tali che $f(n) \ge c \cdot g(n)$ per ogni $n \ge n_0$. Inoltre
\[
  f(n) = \Theta(g(n)) \iff f(n) = \bigO(g(n)) \ \text{e}\ f(n) = \Omega(g(n)).
\]
\end{definition}

\begin{example}
$3n^2 + 10n + 7 = \Theta(n^2)$: basta prendere $c = 4$ e $n_0 = 11$ per il limite superiore, e $c = 3$ per quello inferiore.
\end{example}

\section{Proprietà utili}

\begin{itemize}
  \item \textbf{Transitività}: se $f = \bigO(g)$ e $g = \bigO(h)$ allora $f = \bigO(h)$.
  \item \textbf{Somma}: $f + g = \bigO(\max(f, g))$.
  \item \textbf{Polinomi}: un polinomio di grado $k$ è $\Theta(n^k)$.
  \item \textbf{Logaritmi}: la base non conta, perché $\log_a n = \dfrac{\log_b n}{\log_b a}$.
\end{itemize}

\begin{theorem}[Criterio del limite]
Se il limite $L = \lim_{n \to \infty} \dfrac{f(n)}{g(n)}$ esiste, allora:
\begin{enumerate}
  \item se $0 < L < \infty$, $f(n) = \Theta(g(n))$;
  \item se $L = 0$, $f(n) = \bigO(g(n))$ ma $f(n) \ne \Omega(g(n))$;
  \item se $L = \infty$, $f(n) = \Omega(g(n))$ ma $f(n) \ne \bigO(g(n))$.
\end{enumerate}
\end{theorem}

\section{Gerarchia delle classi più comuni}

\[
  1 \;\prec\; \log n \;\prec\; \sqrt{n} \;\prec\; n \;\prec\; n \log n \;\prec\; n^2 \;\prec\; 2^n \;\prec\; n!
\]
$tex$, 'esempio'),

  (cid, 'doc', 'lezione-2-ricorrenze-e-teorema-master', 'Lezione 2 – Ricorrenze e Teorema Master', 2, $tex$\section{Algoritmi ricorsivi e ricorrenze}

Il costo di un algoritmo \emph{divide et impera} si descrive con un'\textbf{equazione di ricorrenza}: il problema di dimensione $n$ viene diviso in $a$ sottoproblemi di dimensione $n/b$, più un lavoro $f(n)$ per dividere e ricombinare.
\[
  T(n) = a \, T\!\left(\frac{n}{b}\right) + f(n), \qquad a \ge 1,\ b > 1 .
\]

\begin{example}[Ricerca binaria]
Un solo sottoproblema grande la metà e lavoro costante: $T(n) = T(n/2) + \Theta(1)$.
\end{example}

\section{Il Teorema Master}

\begin{theorem}[Teorema Master]
Sia $T(n) = a\,T(n/b) + f(n)$ con $a \ge 1$, $b > 1$, e sia $d = \log_b a$.
\begin{enumerate}
  \item Se $f(n) = \bigO(n^{d - \varepsilon})$ per qualche $\varepsilon > 0$, allora $T(n) = \Theta(n^{d})$.
  \item Se $f(n) = \Theta(n^{d})$, allora $T(n) = \Theta(n^{d} \log n)$.
  \item Se $f(n) = \Omega(n^{d + \varepsilon})$ per qualche $\varepsilon > 0$ e $a f(n/b) \le c f(n)$ con $c < 1$, allora $T(n) = \Theta(f(n))$.
\end{enumerate}
\end{theorem}

\begin{proof}[Idea della dimostrazione]
L'albero di ricorsione ha altezza $\log_b n$ e al livello $i$ contiene $a^i$ nodi, ciascuno di costo $f(n / b^i)$. Il costo totale è
\[
  T(n) = \Theta(n^{\log_b a}) + \sum_{i=0}^{\log_b n - 1} a^i f\!\left(\frac{n}{b^i}\right).
\]
I tre casi corrispondono a una somma dominata dalle foglie, bilanciata tra i livelli, o dominata dalla radice.
\end{proof}

\section{Esempi svolti}

\begin{tabular}{|l|c|c|l|}
\hline
\textbf{Algoritmo} & \textbf{Ricorrenza} & $d = \log_b a$ & \textbf{Soluzione} \\
\hline
Ricerca binaria & $T(n/2) + 1$ & $0$ & $\Theta(\log n)$ \\
Merge sort & $2T(n/2) + n$ & $1$ & $\Theta(n \log n)$ \\
Karatsuba & $3T(n/2) + n$ & $\approx 1{,}58$ & $\Theta(n^{1{,}58})$ \\
Strassen & $7T(n/2) + n^2$ & $\approx 2{,}81$ & $\Theta(n^{2{,}81})$ \\
\hline
\end{tabular}

\section{Quando il teorema non si applica}

\begin{itemize}
  \item Sottoproblemi di dimensioni diverse, come $T(n) = T(n/3) + T(2n/3) + n$.
  \item Ricorrenze lineari, come $T(n) = T(n-1) + n$, che si risolve per sostituzione: $T(n) = \sum_{k=1}^{n} k = \dfrac{n(n+1)}{2} = \Theta(n^2)$.
\end{itemize}
$tex$, 'esempio'),

  (cid, 'doc', 'lezione-3-algoritmi-di-ordinamento', 'Lezione 3 – Algoritmi di ordinamento', 3, $tex$\section{Il problema}

Dato un array $A[1..n]$ di elementi confrontabili, vogliamo una permutazione tale che $A[1] \le A[2] \le \dots \le A[n]$.

\begin{definition}
Un algoritmo di ordinamento è \textbf{stabile} se mantiene l'ordine relativo degli elementi con chiave uguale, ed è \textbf{in loco} se usa $\bigO(1)$ memoria aggiuntiva.
\end{definition}

\section{Merge sort}

\begin{enumerate}
  \item \textbf{Dividi}: spezza l'array in due metà di dimensione $\floor{n/2}$ e $\ceil{n/2}$.
  \item \textbf{Risolvi}: ordina ricorsivamente le due metà.
  \item \textbf{Combina}: fondi le due metà ordinate in tempo $\Theta(n)$.
\end{enumerate}

\begin{verbatim}
mergeSort(A, l, r):
    if l < r:
        m = (l + r) / 2
        mergeSort(A, l, m)
        mergeSort(A, m + 1, r)
        merge(A, l, m, r)
\end{verbatim}

La ricorrenza è $T(n) = 2T(n/2) + \Theta(n)$, quindi per il Teorema Master $T(n) = \Theta(n \log n)$.

\section{Confronto}

\begin{tabular}{|l|c|c|c|c|}
\hline
\textbf{Algoritmo} & \textbf{Caso medio} & \textbf{Caso pessimo} & \textbf{Stabile} & \textbf{In loco} \\
\hline
Insertion sort & $\Theta(n^2)$ & $\Theta(n^2)$ & sì & sì \\
Merge sort & $\Theta(n \log n)$ & $\Theta(n \log n)$ & sì & no \\
Quicksort & $\Theta(n \log n)$ & $\Theta(n^2)$ & no & sì \\
Heapsort & $\Theta(n \log n)$ & $\Theta(n \log n)$ & no & sì \\
\hline
\end{tabular}

\section{Limite inferiore}

\begin{theorem}
Ogni algoritmo di ordinamento basato su confronti esegue $\Omega(n \log n)$ confronti nel caso pessimo.
\end{theorem}

\begin{proof}
L'algoritmo si può vedere come un albero di decisione binario con almeno $n!$ foglie, una per ogni permutazione. Un albero binario di altezza $h$ ha al più $2^h$ foglie, quindi
\[
  h \ge \log_2 (n!) = \sum_{k=1}^{n} \log_2 k \ge \frac{n}{2} \log_2 \frac{n}{2} = \Omega(n \log n). \qedhere
\]
\end{proof}
$tex$, 'esempio');

  insert into public.document_versions (document_id, content, author, kind)
  select id, content, 'esempio', 'import' from public.documents where course_id = cid;
end $seed$;
