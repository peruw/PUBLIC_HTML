-- =====================================================================
-- Portal /professores/ — 005 tira-dúvidas
-- Qualquer usuário ativo pergunta; só professor (com anúncio, não
-- suspenso) responde, uma resposta por pergunta.
-- =====================================================================

create table if not exists public.questions (
  id bigint generated always as identity primary key,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject_id smallint references public.subjects (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 10 and 160),
  body text not null default '' check (char_length(body) <= 5000),
  status text not null default 'open' check (status in ('open', 'hidden')),
  answers_count int not null default 0,
  created_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
       setweight(to_tsvector('public.pt_unaccent'::regconfig, title), 'A')
    || setweight(to_tsvector('public.pt_unaccent'::regconfig, body), 'B')
  ) stored
);
create index if not exists questions_search_idx on public.questions using gin (search_tsv);
create index if not exists questions_subject_idx on public.questions (subject_id, created_at desc)
  where status = 'open';
create index if not exists questions_author_idx on public.questions (author_id, created_at desc);

create table if not exists public.answers (
  id bigint generated always as identity primary key,
  question_id bigint not null references public.questions (id) on delete cascade,
  tutor_id uuid not null default auth.uid() references public.tutor_profiles (user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 20 and 5000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, tutor_id)
);
create index if not exists answers_tutor_idx on public.answers (tutor_id, created_at desc);

-- ---------- Triggers ----------
-- Contador de respostas publicadas.
create or replace function public.refresh_answers_count() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_q bigint;
begin
  if tg_op = 'DELETE' then
    v_q := old.question_id;
  else
    v_q := new.question_id;
  end if;
  update public.questions q set answers_count =
    (select count(*) from public.answers a where a.question_id = v_q and a.status = 'published')
  where q.id = v_q;
  return null;
end $$;

drop trigger if exists refresh_answers_count on public.answers;
create trigger refresh_answers_count after insert or update or delete on public.answers
  for each row execute function public.refresh_answers_count();

drop trigger if exists answers_updated_at on public.answers;
create trigger answers_updated_at before update on public.answers
  for each row execute function public.set_updated_at();

drop trigger if exists questions_rate_limit on public.questions;
create trigger questions_rate_limit before insert on public.questions
  for each row execute function public.rate_limit('author_id', '1 day', '5');

drop trigger if exists answers_rate_limit on public.answers;
create trigger answers_rate_limit before insert on public.answers
  for each row execute function public.rate_limit('tutor_id', '1 day', '30');

-- Campo computado: nome abreviado de quem perguntou ("Maria S.").
create or replace function public.author_name(public.questions) returns text
language sql stable security definer set search_path = ''
as $$
  select public.short_name(p.full_name)
  from public.profiles p
  where p.id = $1.author_id
    and exists (select 1 from public.questions q where q.id = $1.id and q.author_id = $1.author_id)
$$;

-- Busca de perguntas abertas (alternativa ao .textSearch do cliente).
create or replace function public.search_questions(
  q text default null, p_materia text default null, p_lim int default 20, p_pagina int default 0)
returns table (
  id bigint, title text, subject_slug text, subject_name text, answers_count int,
  created_at timestamptz, author_name text, total bigint)
language sql stable set search_path = ''
as $$
  with p0 as (
    select case when nullif(btrim(q), '') is null then null
                else websearch_to_tsquery('public.pt_unaccent', q) end as tsq
  ),
  p as (
    select case when p0.tsq is null or numnode(p0.tsq) = 0 then null else p0.tsq end as tsq from p0
  )
  select x.id, x.title, s.slug, s.name, x.answers_count, x.created_at, public.author_name(x),
         count(*) over ()
  from public.questions x
  left join public.subjects s on s.id = x.subject_id
  cross join p
  where x.status = 'open'
    and (p.tsq is null or x.search_tsv @@ p.tsq)
    and (p_materia is null or s.slug = p_materia)
  order by case when p.tsq is not null then ts_rank_cd(x.search_tsv, p.tsq) end desc nulls last,
           x.created_at desc, x.id desc
  limit least(greatest(coalesce(p_lim, 20), 1), 50)
  offset greatest(coalesce(p_pagina, 0), 0) * least(greatest(coalesce(p_lim, 20), 1), 50)
$$;

-- ---------- RLS ----------
alter table public.questions enable row level security;
alter table public.answers enable row level security;

drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions for select to anon, authenticated
  using (status = 'open' or author_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists questions_insert on public.questions;
create policy questions_insert on public.questions for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_active_user()));
drop policy if exists questions_update_own on public.questions;
create policy questions_update_own on public.questions for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
drop policy if exists questions_delete_own on public.questions;
create policy questions_delete_own on public.questions for delete to authenticated
  using (author_id = (select auth.uid()));

drop policy if exists answers_select on public.answers;
create policy answers_select on public.answers for select to anon, authenticated
  using (status = 'published' or tutor_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists answers_insert on public.answers;
create policy answers_insert on public.answers for insert to authenticated
  with check (
    tutor_id = (select auth.uid())
    and (select public.is_active_user())
    and exists (select 1 from public.tutor_profiles tp
                where tp.user_id = (select auth.uid()) and not tp.suspended)
    and exists (select 1 from public.questions qq
                where qq.id = answers.question_id and qq.status = 'open')
  );
drop policy if exists answers_update_own on public.answers;
create policy answers_update_own on public.answers for update to authenticated
  using (tutor_id = (select auth.uid())) with check (tutor_id = (select auth.uid()));
drop policy if exists answers_delete_own on public.answers;
create policy answers_delete_own on public.answers for delete to authenticated
  using (tutor_id = (select auth.uid()));

-- ---------- Grants ----------
revoke all on table public.questions, public.answers from anon, authenticated;
grant select on table public.questions, public.answers to anon, authenticated;
grant insert (subject_id, title, body), update (subject_id, title, body), delete
  on table public.questions to authenticated;
grant insert (question_id, body), update (body), delete on table public.answers to authenticated;

revoke execute on function public.refresh_answers_count() from public, anon, authenticated;
revoke execute on function public.author_name(public.questions), public.search_questions(text, text, int, int)
  from public, anon, authenticated;
grant execute on function public.author_name(public.questions), public.search_questions(text, text, int, int)
  to anon, authenticated;
