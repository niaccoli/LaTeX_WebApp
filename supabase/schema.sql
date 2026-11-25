-- Appunti LaTeX — schema completo del database (Supabase / Postgres).
-- Per un progetto Supabase nuovo: incolla questo file nell'SQL Editor ed eseguilo una volta,
-- poi (facoltativo) esegui seed.sql per il corso di esempio.
--
-- Idea di fondo: non ci sono account. Chiunque può LEGGERE le tabelle pubbliche;
-- nessuno può scriverle direttamente. Ogni modifica passa da una funzione (RPC) che
-- controlla il limite di operazioni per IP, le dimensioni e l'eventuale codice di modifica.

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- Tabelle

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(name) between 2 and 120),
  code text check (char_length(code) <= 40),
  academic_year text not null check (char_length(academic_year) <= 20),
  teacher text check (char_length(teacher) <= 120),
  description text not null default '' check (char_length(description) <= 500),
  is_locked boolean not null default false,          -- protetto da codice di modifica
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                             -- non nullo = nel cestino
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  kind text not null default 'doc' check (kind in ('doc', 'preamble')),  -- 'preamble': uno per corso
  slug text not null,
  title text not null check (char_length(title) between 1 and 200),
  position double precision not null default 0,
  content text not null default '' check (octet_length(content) <= 1048576),  -- sorgente LaTeX, max 1 MB
  ystate text,                                       -- stato Yjs (base64) per la scrittura simultanea
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search tsvector generated always as (to_tsvector('italian', title || ' ' || content)) stored,
  unique (course_id, slug)
);
create index documents_course_idx on public.documents (course_id, position);
create index documents_search_idx on public.documents using gin (search);
create unique index documents_one_preamble on public.documents (course_id) where kind = 'preamble';

create table public.document_versions (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  content text not null,
  author text,
  kind text not null default 'auto' check (kind in ('auto', 'restore', 'import')),
  created_at timestamptz not null default now()
);
create index document_versions_doc_idx on public.document_versions (document_id, created_at desc);

-- Vecchi slug dopo una rinomina, così i link già condivisi continuano a funzionare
create table public.slug_redirects (
  id bigint generated always as identity primary key,
  course_id uuid not null references public.courses(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,  -- null = slug di un corso
  old_slug text not null
);
create unique index slug_redirects_course on public.slug_redirects (old_slug) where document_id is null;
create unique index slug_redirects_doc on public.slug_redirects (course_id, old_slug) where document_id is not null;

-- Dati mai esposti all'API: hash del codice di modifica e chiave del canale in tempo reale
create table private.course_secrets (
  course_id uuid primary key references public.courses(id) on delete cascade,
  edit_code_hash text not null,
  channel_key text not null default encode(extensions.gen_random_bytes(16), 'hex')
);

-- Registro delle operazioni per IP (solo l'hash dell'IP), per il rate limiting
create table private.rate_events (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_events_idx on private.rate_events (ip_hash, action, created_at);

-- ---------------------------------------------------------------- Sicurezza

alter table public.courses enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.slug_redirects enable row level security;
alter table private.course_secrets enable row level security;
alter table private.rate_events enable row level security;

create policy "lettura pubblica" on public.courses for select to anon, authenticated using (true);
create policy "lettura pubblica" on public.documents for select to anon, authenticated using (true);
create policy "lettura pubblica" on public.document_versions for select to anon, authenticated using (true);
create policy "lettura pubblica" on public.slug_redirects for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.courses, public.documents, public.document_versions, public.slug_redirects from anon, authenticated;

-- Notifiche in tempo reale sulle modifiche a corsi e documenti
alter publication supabase_realtime add table public.courses, public.documents;

-- ---------------------------------------------------------------- Funzioni di supporto (non esposte)

create function private.slugify(t text) returns text
language sql stable set search_path = '' as $$
  select left(coalesce(nullif(trim(both '-' from regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]+', '-', 'g')), ''), 'senza-titolo'), 80)
$$;

create function private.unique_course_slug(base text, exclude uuid default null) returns text
language plpgsql set search_path = '' as $$
declare s text := base; n int := 1;
begin
  while exists (select 1 from public.courses where slug = s and id is distinct from exclude)
     or exists (select 1 from public.slug_redirects r where r.document_id is null and r.old_slug = s and r.course_id is distinct from exclude)
  loop
    n := n + 1; s := base || '-' || n;
  end loop;
  return s;
end $$;

create function private.unique_document_slug(p_course uuid, base text, exclude uuid default null) returns text
language plpgsql set search_path = '' as $$
declare s text := base; n int := 1;
begin
  while exists (select 1 from public.documents where course_id = p_course and slug = s and id is distinct from exclude)
     or exists (select 1 from public.slug_redirects r where r.course_id = p_course and r.old_slug = s and r.document_id is not null and r.document_id is distinct from exclude)
  loop
    n := n + 1; s := base || '-' || n;
  end loop;
  return s;
end $$;

-- IP di chi chiama, dagli header che PostgREST mette a disposizione
create function private.client_ip() returns text
language plpgsql stable set search_path = '' as $$
declare h json;
begin
  begin
    h := current_setting('request.headers', true)::json;
  exception when others then h := null;
  end;
  return coalesce(h->>'cf-connecting-ip', nullif(trim(split_part(h->>'x-forwarded-for', ',', 1)), ''), 'unknown');
end $$;

-- Rate limiting: al massimo p_max operazioni di tipo p_action per IP nella finestra indicata
create function private.check_rate(p_action text, p_max int, p_window interval default '1 hour') returns void
language plpgsql set search_path = '' as $$
declare h text := encode(extensions.digest(private.client_ip(), 'sha256'), 'hex'); c int;
begin
  select count(*) into c from private.rate_events
   where ip_hash = h and action = p_action and created_at > now() - p_window;
  if c >= p_max then
    raise exception 'Troppe operazioni in poco tempo: riprova più tardi.' using hint = 'RATE_LIMIT';
  end if;
  insert into private.rate_events (ip_hash, action) values (h, p_action);
  delete from private.rate_events where created_at < now() - interval '1 day';
end $$;

-- Se il corso è protetto, pretende il codice di modifica giusto
create function private.assert_can_edit(p_course uuid, p_code text) returns void
language plpgsql set search_path = '' as $$
declare locked boolean; hsh text;
begin
  select is_locked into locked from public.courses where id = p_course;
  if not found then raise exception 'Corso non trovato.' using hint = 'NOT_FOUND'; end if;
  if locked then
    select edit_code_hash into hsh from private.course_secrets where course_id = p_course;
    if hsh is null or p_code is null or extensions.crypt(p_code, hsh) <> hsh then
      raise exception 'Questo corso è bloccato: serve il codice di modifica.' using hint = 'EDIT_CODE';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- API pubblica (RPC)
-- Limiti: 20 corsi/ora, 100 documenti/ora, 20 eliminazioni/ora, 30 verifiche del codice/ora per IP;
-- 1 MB per documento. Per cambiarli, modifica i numeri nelle chiamate a check_rate qui sotto.

-- p_layout: 'split' (default) = preambolo condiviso + documenti per capitolo;
-- 'single' = un solo documento LaTeX completo, senza preambolo condiviso.
create function public.create_course(
  p_name text, p_academic_year text, p_code text default null, p_teacher text default null,
  p_description text default ''::text, p_edit_code text default null, p_layout text default 'split')
returns public.courses language plpgsql security definer set search_path = '' as $$
declare c public.courses; v_name text := trim(coalesce(p_name, '')); v_lock boolean := coalesce(p_edit_code, '') <> '';
        v_title text;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Il nome del corso deve avere tra 2 e 120 caratteri.' using hint = 'VALIDATION';
  end if;
  if v_lock and char_length(p_edit_code) < 6 then
    raise exception 'Il codice di modifica deve avere almeno 6 caratteri.' using hint = 'VALIDATION';
  end if;
  if coalesce(p_layout, 'split') not in ('split', 'single') then
    raise exception 'Struttura del corso non valida.' using hint = 'VALIDATION';
  end if;
  perform private.check_rate('create_course', 20);
  insert into public.courses (slug, name, code, academic_year, teacher, description, is_locked)
  values (private.unique_course_slug(private.slugify(v_name)), v_name, nullif(trim(p_code), ''),
          coalesce(nullif(trim(p_academic_year), ''), '—'), nullif(trim(p_teacher), ''),
          left(coalesce(p_description, ''), 500), v_lock)
  returning * into c;
  if v_lock then
    insert into private.course_secrets (course_id, edit_code_hash)
    values (c.id, extensions.crypt(p_edit_code, extensions.gen_salt('bf', 8)));
  end if;
  if coalesce(p_layout, 'split') = 'single' then
    -- Un solo documento completo (si compila così com'è), niente preambolo condiviso
    v_title := regexp_replace(replace(v_name, E'\\', ''), '([&%$#_{}])', E'\\\\\\1', 'g');
    insert into public.documents (course_id, kind, slug, title, position, content)
    values (c.id, 'doc', 'appunti', 'Appunti', 1,
            E'\\documentclass[11pt,a4paper]{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n'
            || E'\\usepackage[a4paper,margin=2.5cm]{geometry}\n\\usepackage{amsmath, amssymb, amsthm}\n\\usepackage{graphicx}\n\n'
            || E'\\title{' || v_title || E'}\n\\author{}\n\\date{}\n\n\\begin{document}\n\\maketitle\n\n'
            || E'\\section{Introduzione}\nScrivi qui i tuoi appunti.\n\n\\end{document}\n');
  else
    insert into public.documents (course_id, kind, slug, title, position, content)
    values (c.id, 'preamble', 'preambolo', 'Preambolo', 0,
            E'% Macro e pacchetti condivisi da tutti i documenti del corso\n');
  end if;
  return c;
end $$;

create function public.update_course(p_id uuid, p_name text, p_academic_year text, p_code text default null,
  p_teacher text default null, p_description text default '', p_edit_code text default null)
returns public.courses language plpgsql security definer set search_path = '' as $$
declare c public.courses; v_name text := trim(coalesce(p_name, '')); v_slug text;
begin
  perform private.assert_can_edit(p_id, p_edit_code);
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Il nome del corso deve avere tra 2 e 120 caratteri.' using hint = 'VALIDATION';
  end if;
  select * into c from public.courses where id = p_id;
  v_slug := c.slug;
  if v_name <> c.name then
    v_slug := private.unique_course_slug(private.slugify(v_name), p_id);
    if v_slug <> c.slug then
      delete from public.slug_redirects where document_id is null and old_slug = v_slug;
      insert into public.slug_redirects (course_id, old_slug) values (p_id, c.slug);
    end if;
  end if;
  update public.courses set slug = v_slug, name = v_name, code = nullif(trim(p_code), ''),
         academic_year = coalesce(nullif(trim(p_academic_year), ''), '—'), teacher = nullif(trim(p_teacher), ''),
         description = left(coalesce(p_description, ''), 500), updated_at = now()
   where id = p_id returning * into c;
  return c;
end $$;

create function public.delete_course(p_id uuid, p_edit_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_can_edit(p_id, p_edit_code);
  perform private.check_rate('delete', 20);
  update public.courses set deleted_at = now() where id = p_id and deleted_at is null;
end $$;

create function public.restore_course(p_id uuid, p_edit_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_can_edit(p_id, p_edit_code);
  update public.courses set deleted_at = null where id = p_id;
end $$;

create function public.verify_edit_code(p_id uuid, p_edit_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  -- Fuori dal blocco con exception: così anche i tentativi sbagliati vengono contati
  perform private.check_rate('verify_code', 30);
  begin
    perform private.assert_can_edit(p_id, p_edit_code);
    return true;
  exception when raise_exception then
    return false;
  end;
end $$;

-- Chiave del canale di modifica in tempo reale: solo chi ha il codice la ottiene,
-- quindi chi legge soltanto non può inviare modifiche agli altri. Null per i corsi non protetti.
create function public.get_channel_key(p_id uuid, p_edit_code text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  perform private.check_rate('verify_code', 30);
  perform private.assert_can_edit(p_id, p_edit_code);
  select channel_key into k from private.course_secrets where course_id = p_id;
  return k;
end $$;

-- Il codice si imposta solo alla creazione; chi lo conosce può cambiarlo o toglierlo
create function public.change_edit_code(p_id uuid, p_edit_code text, p_new_code text default null)
returns public.courses language plpgsql security definer set search_path = '' as $$
declare c public.courses;
begin
  select * into c from public.courses where id = p_id;
  if not found or not c.is_locked then
    raise exception 'Il codice si può impostare solo alla creazione del corso.' using hint = 'VALIDATION';
  end if;
  perform private.assert_can_edit(p_id, p_edit_code);
  if coalesce(p_new_code, '') = '' then
    delete from private.course_secrets where course_id = p_id;
    update public.courses set is_locked = false, updated_at = now() where id = p_id returning * into c;
  else
    if char_length(p_new_code) < 6 then
      raise exception 'Il codice di modifica deve avere almeno 6 caratteri.' using hint = 'VALIDATION';
    end if;
    update private.course_secrets set edit_code_hash = extensions.crypt(p_new_code, extensions.gen_salt('bf', 8)) where course_id = p_id;
  end if;
  return c;
end $$;

create function public.create_document(p_course_id uuid, p_title text, p_content text default '',
  p_author text default null, p_edit_code text default null)
returns public.documents language plpgsql security definer set search_path = '' as $$
declare d public.documents; v_title text := trim(coalesce(p_title, '')); v_pos double precision;
begin
  perform private.assert_can_edit(p_course_id, p_edit_code);
  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'Il titolo deve avere tra 1 e 200 caratteri.' using hint = 'VALIDATION';
  end if;
  if octet_length(coalesce(p_content, '')) > 1048576 then
    raise exception 'Il documento supera il limite di 1 MB.' using hint = 'TOO_LARGE';
  end if;
  perform private.check_rate('create_document', 100);
  select coalesce(max(position), 0) + 1 into v_pos from public.documents where course_id = p_course_id;
  insert into public.documents (course_id, slug, title, position, content, updated_by)
  values (p_course_id, private.unique_document_slug(p_course_id, private.slugify(v_title)), v_title, v_pos,
          coalesce(p_content, ''), left(p_author, 40))
  returning * into d;
  if coalesce(p_content, '') <> '' then
    insert into public.document_versions (document_id, content, author, kind) values (d.id, p_content, left(p_author, 40), 'import');
  end if;
  update public.courses set updated_at = now() where id = p_course_id;
  return d;
end $$;

create function public.rename_document(p_id uuid, p_title text, p_edit_code text default null)
returns public.documents language plpgsql security definer set search_path = '' as $$
declare d public.documents; v_title text := trim(coalesce(p_title, '')); v_slug text;
begin
  select * into d from public.documents where id = p_id;
  if not found then raise exception 'Documento non trovato.' using hint = 'NOT_FOUND'; end if;
  perform private.assert_can_edit(d.course_id, p_edit_code);
  if d.kind = 'preamble' then raise exception 'Il preambolo non si può rinominare.' using hint = 'VALIDATION'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'Il titolo deve avere tra 1 e 200 caratteri.' using hint = 'VALIDATION';
  end if;
  v_slug := private.unique_document_slug(d.course_id, private.slugify(v_title), p_id);
  if v_slug <> d.slug then
    delete from public.slug_redirects where course_id = d.course_id and document_id = p_id and old_slug = v_slug;
    insert into public.slug_redirects (course_id, document_id, old_slug) values (d.course_id, p_id, d.slug);
  end if;
  update public.documents set title = v_title, slug = v_slug, updated_at = now() where id = p_id returning * into d;
  return d;
end $$;

create function public.delete_document(p_id uuid, p_edit_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_id;
  if not found then raise exception 'Documento non trovato.' using hint = 'NOT_FOUND'; end if;
  perform private.assert_can_edit(d.course_id, p_edit_code);
  if d.kind = 'preamble' then raise exception 'Il preambolo non si può eliminare.' using hint = 'VALIDATION'; end if;
  perform private.check_rate('delete', 20);
  update public.documents set deleted_at = now() where id = p_id and deleted_at is null;
end $$;

create function public.restore_document(p_id uuid, p_edit_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_id;
  if not found then raise exception 'Documento non trovato.' using hint = 'NOT_FOUND'; end if;
  perform private.assert_can_edit(d.course_id, p_edit_code);
  update public.documents set deleted_at = null where id = p_id;
end $$;

create function public.reorder_documents(p_course_id uuid, p_ids uuid[], p_edit_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_can_edit(p_course_id, p_edit_code);
  update public.documents d set position = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where d.id = o.id and d.course_id = p_course_id and d.kind = 'doc';
end $$;

-- Salva testo e stato Yjs insieme. Crea una versione nella cronologia se il testo è cambiato e:
-- p_snapshot è vero (pausa nella scrittura), oppure l'ultima versione ha più di 2 minuti,
-- oppure è un ripristino. Versioni dello stesso autore a meno di 30 secondi si fondono in una.
create function public.save_document(p_id uuid, p_content text, p_ystate text default null, p_author text default null,
  p_snapshot boolean default false, p_kind text default 'auto', p_edit_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.documents; last public.document_versions; v_author text := left(p_author, 40); v_version boolean := false; v_now timestamptz := now();
begin
  select * into d from public.documents where id = p_id;
  if not found then raise exception 'Documento non trovato.' using hint = 'NOT_FOUND'; end if;
  perform private.assert_can_edit(d.course_id, p_edit_code);
  if octet_length(coalesce(p_content, '')) > 1048576 then
    raise exception 'Il documento supera il limite di 1 MB.' using hint = 'TOO_LARGE';
  end if;
  if octet_length(coalesce(p_ystate, '')) > 12582912 then
    raise exception 'Lo stato di sincronizzazione del documento è troppo grande.' using hint = 'TOO_LARGE';
  end if;
  if p_kind not in ('auto', 'restore') then p_kind := 'auto'; end if;
  update public.documents set content = coalesce(p_content, ''), ystate = coalesce(p_ystate, ystate),
         updated_by = v_author, updated_at = v_now where id = p_id;

  select * into last from public.document_versions where document_id = p_id order by created_at desc, id desc limit 1;
  if last.id is null or last.content is distinct from p_content then
    if p_kind = 'restore' or p_snapshot or last.id is null or last.created_at < v_now - interval '2 minutes' then
      if p_kind = 'auto' and last.id is not null and last.kind = 'auto'
         and last.author is not distinct from v_author and last.created_at > v_now - interval '30 seconds' then
        update public.document_versions set content = p_content, created_at = v_now where id = last.id;
      else
        insert into public.document_versions (document_id, content, author, kind) values (p_id, p_content, v_author, p_kind);
      end if;
      v_version := true;
      perform private.prune_versions(p_id);
    end if;
  end if;
  return jsonb_build_object('updated_at', v_now, 'version_created', v_version);
end $$;

-- Ricerca nel testo dei documenti di un corso: parole intere (full-text in italiano)
-- oppure, in mancanza, la stringa così com'è (utile per comandi LaTeX e parole incomplete).
create function public.search_documents(p_course_id uuid, p_query text)
returns table (id uuid, slug text, title text, snippet text)
language sql stable set search_path = '' as $$
  with q as (
    select websearch_to_tsquery('italian', p_query) as ts,
           '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select d.id, d.slug, d.title,
         case
           when d.search @@ q.ts then
             ts_headline('italian', d.content, q.ts, 'StartSel=«, StopSel=», MaxWords=20, MinWords=8, MaxFragments=2, FragmentDelimiter=" … "')
           when d.content ilike q.pattern then
             regexp_replace(substring(d.content from greatest(1, position(lower(trim(p_query)) in lower(d.content)) - 50) for 160), '\s+', ' ', 'g')
           else ''
         end as snippet
    from public.documents d, q
   where d.course_id = p_course_id and d.kind = 'doc' and d.deleted_at is null
     and char_length(trim(p_query)) >= 2
     and (d.search @@ q.ts or d.content ilike q.pattern or d.title ilike q.pattern)
   order by ts_rank(d.search, q.ts) desc, d.position
   limit 30
$$;

-- ---------------------------------------------------------------------------
-- Potatura della cronologia: della sessione più recente si tengono le ultime 5 versioni;
-- delle 5 sessioni precedenti si tiene solo l'ultima versione di ciascuna.
-- Una nuova sessione inizia dopo una pausa di almeno 6 ore senza salvataggi.
-- È chiamata da save_document a ogni nuova versione; i numeri sono i parametri di default.
-- ---------------------------------------------------------------------------
create or replace function private.prune_versions(
  p_doc uuid, p_current_keep integer default 5, p_past_sessions integer default 5, p_gap interval default '6 hours')
returns void language sql set search_path = '' as $$
  with v as (
    select id, created_at,
           case when lag(created_at) over w is null or created_at - lag(created_at) over w > p_gap then 1 else 0 end as starts
      from public.document_versions
     where document_id = p_doc
    window w as (order by created_at, id)
  ), s as (
    select id, created_at, sum(starts) over (order by created_at, id) as session_no from v
  ), r as (
    select id,
           dense_rank() over (order by session_no desc) as session_rank,
           row_number() over (partition by session_no order by created_at desc, id desc) as pos
      from s
  )
  delete from public.document_versions d using r
   where d.id = r.id
     and not ((r.session_rank = 1 and r.pos <= p_current_keep)
           or (r.session_rank between 2 and 1 + p_past_sessions and r.pos = 1))
$$;

-- ---------------------------------------------------------------------------
-- Immagini dei corsi (PNG/JPEG, max 1 MB l'una, 25 MB per corso, 250 MB in totale).
-- I byte non si leggono dalla tabella: solo con get_image_data. Scrittura solo via funzioni.
-- ---------------------------------------------------------------------------
create table public.course_images (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  size integer not null check (size between 1 and 1048576),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  data bytea not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (course_id, name)
);
create index course_images_course_idx on public.course_images (course_id);

alter table public.course_images enable row level security;
create policy "lettura pubblica" on public.course_images for select to anon, authenticated using (true);
revoke all on public.course_images from anon, authenticated;
grant select (id, course_id, name, mime, size, width, height, created_by, created_at) on public.course_images to anon, authenticated;

create or replace function public.upload_image(
  p_course_id uuid, p_name text, p_mime text, p_data text,
  p_width integer default null, p_height integer default null,
  p_author text default null, p_edit_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_bytes bytea; v_name text; v_base text; v_ext text; v_n integer := 1; v_id uuid; v_at timestamptz := now();
  v_course_total bigint; v_all_total bigint;
begin
  perform private.assert_can_edit(p_course_id, p_edit_code);
  if p_mime not in ('image/png', 'image/jpeg') then
    raise exception 'Sono ammesse solo immagini PNG o JPEG.' using hint = 'VALIDATION';
  end if;
  if octet_length(coalesce(p_data, '')) > 1500000 then
    raise exception 'L''immagine supera il limite di 1 MB.' using hint = 'TOO_LARGE';
  end if;
  begin
    v_bytes := decode(coalesce(p_data, ''), 'base64');
  exception when others then
    raise exception 'Immagine non valida.' using hint = 'VALIDATION';
  end;
  if octet_length(v_bytes) < 16 then
    raise exception 'Immagine non valida.' using hint = 'VALIDATION';
  end if;
  if octet_length(v_bytes) > 1048576 then
    raise exception 'L''immagine supera il limite di 1 MB.' using hint = 'TOO_LARGE';
  end if;
  if (p_mime = 'image/png' and substring(v_bytes from 1 for 8) <> '\x89504e470d0a1a0a'::bytea)
     or (p_mime = 'image/jpeg' and substring(v_bytes from 1 for 3) <> '\xffd8ff'::bytea) then
    raise exception 'Il file non è un''immagine %.', case p_mime when 'image/png' then 'PNG' else 'JPEG' end using hint = 'VALIDATION';
  end if;

  v_ext := case p_mime when 'image/png' then 'png' else 'jpg' end;
  v_base := trim(both '-' from regexp_replace(regexp_replace(lower(extensions.unaccent(coalesce(p_name, ''))), '\.[a-z0-9]+$', ''), '[^a-z0-9]+', '-', 'g'));
  v_base := left(coalesce(nullif(v_base, ''), 'immagine'), 60);
  v_name := v_base || '.' || v_ext;
  while exists (select 1 from public.course_images where course_id = p_course_id and name = v_name) loop
    v_n := v_n + 1;
    v_name := v_base || '-' || v_n || '.' || v_ext;
  end loop;

  select coalesce(sum(size), 0) into v_course_total from public.course_images where course_id = p_course_id;
  if v_course_total + octet_length(v_bytes) > 26214400 then
    raise exception 'Questo corso ha raggiunto il limite di 25 MB di immagini.' using hint = 'TOO_LARGE';
  end if;
  select coalesce(sum(size), 0) into v_all_total from public.course_images;
  if v_all_total + octet_length(v_bytes) > 262144000 then
    raise exception 'Lo spazio per le immagini del sito è esaurito.' using hint = 'TOO_LARGE';
  end if;
  perform private.check_rate('upload_image', 40);

  insert into public.course_images (course_id, name, mime, size, width, height, data, created_by)
  values (p_course_id, v_name, p_mime, octet_length(v_bytes), p_width, p_height, v_bytes, left(p_author, 40))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'course_id', p_course_id, 'name', v_name, 'mime', p_mime,
                            'size', octet_length(v_bytes), 'width', p_width, 'height', p_height,
                            'created_by', left(p_author, 40), 'created_at', v_at);
end $$;

create or replace function public.delete_image(p_id uuid, p_edit_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_course uuid;
begin
  select course_id into v_course from public.course_images where id = p_id;
  if not found then raise exception 'Immagine non trovata.' using hint = 'NOT_FOUND'; end if;
  perform private.assert_can_edit(v_course, p_edit_code);
  perform private.check_rate('delete', 20);
  delete from public.course_images where id = p_id;
end $$;

create or replace function public.get_image_data(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select translate(encode(data, 'base64'), E'\n', '') from public.course_images where id = p_id
$$;
