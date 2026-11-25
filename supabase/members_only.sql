-- Accesso riservato: solo chi ha un account e la cui email è nell'elenco può leggere o scrivere.
-- Gli account si creano da Supabase (Authentication → Users → Add user, con "Auto Confirm User"),
-- le email autorizzate si aggiungono con:  insert into private.allowed_emails (email) values ('nome@esempio.it');

create table if not exists private.allowed_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
revoke all on private.allowed_emails from anon, authenticated;

-- Vero solo per un account autenticato la cui email è nell'elenco
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and exists (select 1 from private.allowed_emails where email = lower(auth.jwt() ->> 'email'))
$$;

-- Lettura: solo soci
drop policy if exists "lettura pubblica" on public.courses;
drop policy if exists "lettura pubblica" on public.documents;
drop policy if exists "lettura pubblica" on public.document_versions;
drop policy if exists "lettura pubblica" on public.slug_redirects;
drop policy if exists "lettura pubblica" on public.course_images;
create policy "lettura soci" on public.courses for select to authenticated using (public.is_member());
create policy "lettura soci" on public.documents for select to authenticated using (public.is_member());
create policy "lettura soci" on public.document_versions for select to authenticated using (public.is_member());
create policy "lettura soci" on public.slug_redirects for select to authenticated using (public.is_member());
create policy "lettura soci" on public.course_images for select to authenticated using (public.is_member());
revoke select on public.courses, public.documents, public.document_versions, public.slug_redirects from anon;
revoke all on public.course_images from anon;

-- Ogni operazione di scrittura passa da qui: senza account autorizzato si ferma subito
create or replace function private.check_rate(p_action text, p_max integer, p_window interval default '01:00:00'::interval)
returns void language plpgsql set search_path = '' as $$
declare h text := encode(extensions.digest(private.client_ip(), 'sha256'), 'hex'); c int;
begin
  if not public.is_member() then raise exception 'Accesso riservato: accedi con un account autorizzato.' using hint = 'AUTH'; end if;
  select count(*) into c from private.rate_events
   where ip_hash = h and action = p_action and created_at > now() - p_window;
  if c >= p_max then
    raise exception 'Troppe operazioni in poco tempo: riprova più tardi.' using hint = 'RATE_LIMIT';
  end if;
  insert into private.rate_events (ip_hash, action) values (h, p_action);
  delete from private.rate_events where created_at < now() - interval '1 day';
end $$;

create or replace function private.assert_can_edit(p_course uuid, p_code text)
returns void language plpgsql set search_path = '' as $$
declare locked boolean; hsh text;
begin
  if not public.is_member() then raise exception 'Accesso riservato: accedi con un account autorizzato.' using hint = 'AUTH'; end if;
  select is_locked into locked from public.courses where id = p_course;
  if not found then raise exception 'Corso non trovato.' using hint = 'NOT_FOUND'; end if;
  if locked then
    select edit_code_hash into hsh from private.course_secrets where course_id = p_course;
    if hsh is null or p_code is null or extensions.crypt(p_code, hsh) <> hsh then
      raise exception 'Questo corso è bloccato: serve il codice di modifica.' using hint = 'EDIT_CODE';
    end if;
  end if;
end $$;

create or replace function public.get_image_data(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select translate(encode(data, 'base64'), E'\n', '') from public.course_images where id = p_id and public.is_member()
$$;

-- Nessuna funzione è chiamabile senza account
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
