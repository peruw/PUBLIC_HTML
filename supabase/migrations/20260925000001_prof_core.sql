-- =====================================================================
-- Portal /professores/ — 001 núcleo
-- Perfis, planos, matérias, anúncios de professores, busca (search_tutors).
-- Convenções: RLS em tudo, revoke + grants mínimos (por coluna), funções
-- security definer com search_path = '' e nomes qualificados.
-- =====================================================================

-- ---------- Busca em português sem acentos ----------
create extension if not exists unaccent with schema extensions;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_ts_config
    where cfgname = 'pt_unaccent' and cfgnamespace = 'public'::regnamespace
  ) then
    create text search configuration public.pt_unaccent (copy = pg_catalog.portuguese);
    alter text search configuration public.pt_unaccent
      alter mapping for hword, hword_part, word with extensions.unaccent, pg_catalog.portuguese_stem;
  end if;
end $$;

-- ---------- Helpers puros ----------
create or replace function public.f_unaccent(text) returns text
language sql immutable parallel safe strict set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- "Ana Maria  Sá!" -> "ana-maria-sa"
create or replace function public.slugify(p text) returns text
language sql immutable parallel safe set search_path = ''
as $$
  select btrim(regexp_replace(lower(public.f_unaccent(coalesce(p, ''))), '[^a-z0-9]+', '-', 'g'), '-')
$$;

-- "Maria da Silva" -> "Maria S." (nome público abreviado)
create or replace function public.short_name(p text) returns text
language plpgsql immutable parallel safe set search_path = ''
as $$
declare
  parts text[] := regexp_split_to_array(btrim(coalesce(p, '')), '\s+');
  n int := coalesce(array_length(parts, 1), 0);
begin
  if n = 0 or parts[1] = '' then
    return 'Usuário';
  elsif n = 1 then
    return parts[1];
  end if;
  return parts[1] || ' ' || upper(left(parts[n], 1)) || '.';
end $$;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

-- ---------- Tabelas ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'tutor')),
  full_name text not null default '' check (char_length(full_name) <= 80),
  avatar_path text check (avatar_path is null or split_part(avatar_path, '/', 1) = id::text),
  is_admin boolean not null default false,
  banned_at timestamptz,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  code text primary key check (code in ('basico', 'profissional', 'premium')),
  name text not null,
  price_cents_month int not null check (price_cents_month >= 0),
  max_subjects int not null check (max_subjects > 0),
  rank_tier smallint not null default 0,
  features text[] not null default '{}'
);

create table if not exists public.subjects (
  id smallint generated always as identity primary key,
  slug text not null unique,
  name text not null unique,
  category text not null
);

create table if not exists public.tutor_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  headline text not null default '' check (char_length(headline) <= 120),
  bio text not null default '' check (char_length(bio) <= 4000),
  hourly_rate_cents int check (hourly_rate_cents between 0 and 100000),
  mode_online boolean not null default true,
  mode_presencial boolean not null default false,
  uf char(2) check (uf ~ '^[A-Z]{2}$'),
  city_ibge int check (city_ibge between 1000000 and 9999999),
  city_name text check (char_length(city_name) <= 80),
  published boolean not null default false,
  suspended boolean not null default false,
  plan text not null default 'basico' references public.plans (code),
  plan_expires_at timestamptz,
  rating_avg numeric(3, 2) not null default 0,
  rating_count int not null default 0,
  search_tsv tsvector,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tutor_profiles_search_idx on public.tutor_profiles using gin (search_tsv);
create index if not exists tutor_profiles_local_idx on public.tutor_profiles (uf, city_ibge)
  where published and not suspended;
create index if not exists tutor_profiles_price_idx on public.tutor_profiles (hourly_rate_cents)
  where published and not suspended;

create table if not exists public.tutor_subjects (
  tutor_id uuid not null references public.tutor_profiles (user_id) on delete cascade,
  subject_id smallint not null references public.subjects (id) on delete cascade,
  levels text[] not null default '{}'
    check (levels <@ array['infantil', 'fundamental', 'medio', 'vestibular', 'superior', 'concursos', 'adulto']::text[]),
  primary key (tutor_id, subject_id)
);
create index if not exists tutor_subjects_subject_idx on public.tutor_subjects (subject_id);

-- ---------- Dados de referência ----------
insert into public.plans (code, name, price_cents_month, max_subjects, rank_tier, features) values
  ('basico', 'Básico', 0, 3, 0,
    array['Perfil público na busca', 'Até 3 matérias', 'Mensagens com alunos']),
  ('profissional', 'Profissional', 2990, 10, 1,
    array['Até 10 matérias', 'Prioridade na busca', 'Selo Profissional']),
  ('premium', 'Premium', 5990, 30, 2,
    array['Até 30 matérias', 'Selo Destaque', 'Topo da busca'])
on conflict (code) do nothing;

insert into public.subjects (slug, name, category)
select public.slugify(v.name), v.name, v.category
from (values
  ('Matemática', 'Exatas'), ('Física', 'Exatas'), ('Química', 'Exatas'), ('Estatística', 'Exatas'),
  ('Cálculo', 'Exatas'), ('Álgebra Linear', 'Exatas'), ('Geometria', 'Exatas'), ('Matemática Financeira', 'Exatas'),
  ('Biologia', 'Ciências'), ('Ciências', 'Ciências'),
  ('História', 'Humanas'), ('Geografia', 'Humanas'), ('Filosofia', 'Humanas'), ('Sociologia', 'Humanas'),
  ('Português', 'Linguagens'), ('Redação', 'Linguagens'), ('Literatura', 'Linguagens'),
  ('Inglês', 'Idiomas'), ('Espanhol', 'Idiomas'), ('Francês', 'Idiomas'), ('Alemão', 'Idiomas'),
  ('Italiano', 'Idiomas'), ('Japonês', 'Idiomas'), ('Mandarim', 'Idiomas'), ('Libras', 'Idiomas'),
  ('Português para Estrangeiros', 'Idiomas'),
  ('Programação', 'Tecnologia'), ('Python', 'Tecnologia'), ('JavaScript', 'Tecnologia'), ('Excel', 'Tecnologia'),
  ('Informática', 'Tecnologia'), ('Robótica', 'Tecnologia'),
  ('Violão', 'Música'), ('Guitarra', 'Música'), ('Piano e Teclado', 'Música'), ('Canto', 'Música'),
  ('Bateria', 'Música'), ('Teoria Musical', 'Música'),
  ('ENEM', 'Preparatórios'), ('Vestibulares', 'Preparatórios'), ('Concursos Públicos', 'Preparatórios'),
  ('OAB', 'Preparatórios'),
  ('Reforço Escolar', 'Reforço'), ('Alfabetização', 'Reforço'), ('Psicopedagogia', 'Reforço'),
  ('Xadrez', 'Outros')
) as v(name, category)
on conflict do nothing;

-- ---------- Plano efetivo e papéis ----------
-- Plano vencido volta a ser básico (sem cron).
create or replace function public.effective_plan(p_plan text, p_exp timestamptz) returns text
language sql stable set search_path = ''
as $$
  select case when p_plan is not null and p_plan <> 'basico' and p_exp > now() then p_plan else 'basico' end
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select p.is_admin and p.banned_at is null
    from public.profiles p where p.id = (select auth.uid())
  ), false)
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.banned_at is null
  )
$$;

-- ---------- Triggers de tutor_profiles ----------
-- Valida publicação e reconstrói o índice de busca.
create or replace function public.tutor_before_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_subjects text;
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    if btrim(coalesce(new.headline, '')) = '' then
      raise exception 'Preencha o título do anúncio antes de publicar.' using errcode = 'P0001';
    end if;
    if new.hourly_rate_cents is null then
      raise exception 'Informe o valor da hora-aula antes de publicar.' using errcode = 'P0001';
    end if;
    if not (new.mode_online or new.mode_presencial) then
      raise exception 'Escolha aulas online e/ou presenciais antes de publicar.' using errcode = 'P0001';
    end if;
    if new.mode_presencial and (new.uf is null or new.city_ibge is null) then
      raise exception 'Informe estado e cidade para aulas presenciais.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.tutor_subjects ts where ts.tutor_id = new.user_id) then
      raise exception 'Adicione ao menos uma matéria antes de publicar.' using errcode = 'P0001';
    end if;
  end if;

  select p.full_name into v_name from public.profiles p where p.id = new.user_id;
  select string_agg(s.name, ' ' order by s.name) into v_subjects
    from public.tutor_subjects ts join public.subjects s on s.id = ts.subject_id
    where ts.tutor_id = new.user_id;

  new.search_tsv :=
       setweight(to_tsvector('public.pt_unaccent',
         coalesce(v_name, '') || ' ' || coalesce(new.headline, '') || ' ' || coalesce(v_subjects, '')), 'A')
    || setweight(to_tsvector('public.pt_unaccent', coalesce(new.bio, '')), 'B')
    || setweight(to_tsvector('public.pt_unaccent', coalesce(new.city_name, '')), 'C');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tutor_before_write on public.tutor_profiles;
create trigger tutor_before_write before insert or update on public.tutor_profiles
  for each row execute function public.tutor_before_write();

-- Mudou matéria ou nome: toca o anúncio para reconstruir o tsvector.
create or replace function public.touch_tutor() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'profiles' then
    update public.tutor_profiles set updated_at = now() where user_id = new.id;
  elsif tg_op = 'DELETE' then
    update public.tutor_profiles set updated_at = now() where user_id = old.tutor_id;
  else
    update public.tutor_profiles set updated_at = now() where user_id = new.tutor_id;
  end if;
  return null;
end $$;

drop trigger if exists touch_tutor on public.tutor_subjects;
create trigger touch_tutor after insert or update or delete on public.tutor_subjects
  for each row execute function public.touch_tutor();

drop trigger if exists touch_tutor_name on public.profiles;
create trigger touch_tutor_name after update of full_name on public.profiles
  for each row when (old.full_name is distinct from new.full_name)
  execute function public.touch_tutor();

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Limite de matérias conforme o plano efetivo.
create or replace function public.enforce_subject_limit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max int;
  v_count int;
begin
  -- matéria já cadastrada: deixa o ON CONFLICT/unique resolver (upsert no limite não falha)
  if exists (select 1 from public.tutor_subjects ts
             where ts.tutor_id = new.tutor_id and ts.subject_id = new.subject_id) then
    return new;
  end if;
  -- trava o anúncio: inserções concorrentes não furam o limite
  select pl.max_subjects into v_max
    from public.tutor_profiles tp
    join public.plans pl on pl.code = public.effective_plan(tp.plan, tp.plan_expires_at)
    where tp.user_id = new.tutor_id
    for update of tp;
  select count(*) into v_count from public.tutor_subjects where tutor_id = new.tutor_id;
  if v_count >= coalesce(v_max, 3) then
    raise exception 'Seu plano permite até % matérias. Troque de plano para adicionar mais.', coalesce(v_max, 3)
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists enforce_subject_limit on public.tutor_subjects;
create trigger enforce_subject_limit before insert on public.tutor_subjects
  for each row execute function public.enforce_subject_limit();

-- ---------- Cadastro ----------
-- Cria o anúncio (não publicado) com slug único derivado do nome.
create or replace function public.create_tutor_profile(p_uid uuid, p_name text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n int := 1;
begin
  select tp.slug into v_slug from public.tutor_profiles tp where tp.user_id = p_uid;
  if found then
    return v_slug;
  end if;

  v_base := btrim(left(public.slugify(p_name), 50), '-');
  if char_length(v_base) < 3 then
    v_base := 'professor';
  end if;
  v_slug := v_base;

  loop
    begin
      insert into public.tutor_profiles (user_id, slug) values (p_uid, v_slug)
        on conflict (user_id) do nothing;
      select tp.slug into v_slug from public.tutor_profiles tp where tp.user_id = p_uid;
      return v_slug;
    exception when unique_violation then
      -- slug ocupado: tenta -2, -3… e depois sufixo aleatório
      v_n := v_n + 1;
      v_slug := v_base || '-' || case when v_n <= 20 then v_n::text
                                      else substr(md5(random()::text), 1, 6) end;
    end;
  end loop;
end $$;

-- Perfil criado no signup. Metadata nunca concede admin; nome público nunca vem do e-mail.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role text := case when v_meta ->> 'role' = 'tutor' then 'tutor' else 'student' end;
  -- full_name do formulário; "name" vem de login social (Google)
  v_name text := left(btrim(regexp_replace(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', ''), '\s+', ' ', 'g')), 80);
begin
  if v_name = '' then
    v_name := 'Usuário';
  end if;
  insert into public.profiles (id, role, full_name, terms_accepted_at)
  values (new.id, v_role, v_name,
          case when v_meta ->> 'accepted_terms' = 'true' then now() end)
  on conflict (id) do nothing;
  if v_role = 'tutor' then
    perform public.create_tutor_profile(new.id, v_name);
  end if;
  return new;
end $$;

drop trigger if exists prof_on_auth_user_created on auth.users;
create trigger prof_on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Aluno vira professor (cria anúncio não publicado). Retorna o slug.
create or replace function public.become_tutor() returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.' using errcode = 'P0001';
  end if;
  if not public.is_active_user() then
    raise exception 'Sua conta está suspensa.' using errcode = 'P0001';
  end if;
  update public.profiles set role = 'tutor' where id = v_uid returning full_name into v_name;
  return public.create_tutor_profile(v_uid, v_name);
end $$;

-- ---------- Preço (fonte única) ----------
create or replace function public.plan_price(p_plan text, p_months int) returns int
language plpgsql stable set search_path = ''
as $$
declare
  v_price int;
begin
  if p_months is null or p_months not in (1, 3, 12) then
    raise exception 'Período inválido. Escolha 1, 3 ou 12 meses.' using errcode = 'P0001';
  end if;
  select pl.price_cents_month into v_price from public.plans pl
    where pl.code = p_plan and pl.code <> 'basico';
  if v_price is null then
    raise exception 'Plano inválido.' using errcode = 'P0001';
  end if;
  return round(v_price * p_months * case p_months when 1 then 1.0 when 3 then 0.90 else 0.75 end)::int;
end $$;

-- ---------- Rate limit genérico ----------
-- Uso: before insert … execute function public.rate_limit('coluna_do_ator', '1 day', '5')
create or replace function public.rate_limit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_count int;
begin
  if v_actor is null then
    return new; -- service_role / manutenção
  end if;
  execute format('select count(*) from %I.%I where %I = $1 and created_at > now() - $2::interval',
                 tg_table_schema, tg_table_name, tg_argv[0])
    into v_count using v_actor, tg_argv[1];
  if v_count >= tg_argv[2]::int then
    raise exception 'Limite atingido, tente mais tarde.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------- Busca de professores ----------
-- Ordem padrão: tier do plano → local → relevância → nota bayesiana → rotação diária.
create or replace function public.search_tutors(
  q text default null,
  p_materia text default null,
  p_uf text default null,
  p_cidade int default null,
  p_modo text default null,          -- 'online' | 'presencial' | null
  p_preco_min int default null,
  p_preco_max int default null,
  p_ordem text default 'relevancia', -- relevancia | preco_asc | preco_desc | avaliacao
  p_lim int default 20,
  p_pagina int default 0)
returns table (
  user_id uuid, slug text, full_name text, avatar_path text, headline text, hourly_rate_cents int,
  uf text, city_name text, mode_online boolean, mode_presencial boolean, rating_avg numeric,
  rating_count int, plan text, subjects text[], total bigint)
language sql stable set search_path = ''
as $$
  with p0 as (
    select case when nullif(btrim(q), '') is null then null
                else websearch_to_tsquery('public.pt_unaccent', q) end as tsq
  ),
  p as (
    -- consulta só com stopwords vira "sem filtro"
    select case when p0.tsq is null or numnode(p0.tsq) = 0 then null else p0.tsq end as tsq from p0
  ),
  t as (
    select tp.user_id, tp.slug, pr.full_name, pr.avatar_path, tp.headline, tp.hourly_rate_cents,
           tp.uf::text as uf, tp.city_name, tp.mode_online, tp.mode_presencial,
           tp.rating_avg::numeric as rating_avg, tp.rating_count,
           pl.code as eff_plan, pl.rank_tier,
           (tp.mode_presencial and p_cidade is not null and tp.city_ibge = p_cidade) as is_local,
           (tp.rating_count * tp.rating_avg + 5 * 4.0) / (tp.rating_count + 5) as bayes,
           coalesce(ts_rank_cd(tp.search_tsv, p.tsq), 0) as txt
    from public.tutor_profiles tp
    join public.profiles pr on pr.id = tp.user_id
    join public.plans pl on pl.code = public.effective_plan(tp.plan, tp.plan_expires_at)
    cross join p
    where tp.published and not tp.suspended and pr.banned_at is null
      and (p.tsq is null or tp.search_tsv @@ p.tsq)
      and (p_materia is null or exists (
            select 1 from public.tutor_subjects ts join public.subjects s on s.id = ts.subject_id
            where ts.tutor_id = tp.user_id and s.slug = p_materia))
      and (p_preco_min is null or tp.hourly_rate_cents >= p_preco_min)
      and (p_preco_max is null or tp.hourly_rate_cents <= p_preco_max)
      and case p_modo
            when 'online' then tp.mode_online
            when 'presencial' then tp.mode_presencial
                 and (p_uf is null or tp.uf = p_uf) and (p_cidade is null or tp.city_ibge = p_cidade)
            else tp.mode_online
                 or ((p_uf is null or tp.uf = p_uf) and (p_cidade is null or tp.city_ibge = p_cidade))
          end
  )
  select t.user_id, t.slug, t.full_name, t.avatar_path, t.headline, t.hourly_rate_cents,
         t.uf, t.city_name, t.mode_online, t.mode_presencial, t.rating_avg, t.rating_count, t.eff_plan,
         array(select s.name from public.tutor_subjects ts join public.subjects s on s.id = ts.subject_id
               where ts.tutor_id = t.user_id order by s.name),
         count(*) over ()
  from t
  order by case when coalesce(p_ordem, 'relevancia') = 'relevancia' then t.rank_tier end desc nulls last,
           case when coalesce(p_ordem, 'relevancia') = 'relevancia' then t.is_local end desc nulls last,
           case when p_ordem = 'preco_asc' then t.hourly_rate_cents end asc nulls last,
           case when p_ordem = 'preco_desc' then t.hourly_rate_cents end desc nulls last,
           case when p_ordem = 'avaliacao' then t.bayes end desc nulls last,
           t.txt desc, t.bayes desc, md5(t.user_id::text || current_date::text)
  limit least(greatest(coalesce(p_lim, 20), 1), 50)
  offset greatest(coalesce(p_pagina, 0), 0) * least(greatest(coalesce(p_lim, 20), 1), 50)
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subjects enable row level security;
alter table public.tutor_profiles enable row level security;
alter table public.tutor_subjects enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to anon, authenticated
  using (role = 'tutor' or id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans for select to anon, authenticated using (true);

drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects for select to anon, authenticated using (true);

drop policy if exists tutor_profiles_select on public.tutor_profiles;
create policy tutor_profiles_select on public.tutor_profiles for select to anon, authenticated
  using ((published and not suspended) or user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists tutor_profiles_update_own on public.tutor_profiles;
create policy tutor_profiles_update_own on public.tutor_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists tutor_subjects_select on public.tutor_subjects;
create policy tutor_subjects_select on public.tutor_subjects for select to anon, authenticated using (true);
drop policy if exists tutor_subjects_insert_own on public.tutor_subjects;
create policy tutor_subjects_insert_own on public.tutor_subjects for insert to authenticated
  with check (tutor_id = (select auth.uid()));
drop policy if exists tutor_subjects_update_own on public.tutor_subjects;
create policy tutor_subjects_update_own on public.tutor_subjects for update to authenticated
  using (tutor_id = (select auth.uid())) with check (tutor_id = (select auth.uid()));
drop policy if exists tutor_subjects_delete_own on public.tutor_subjects;
create policy tutor_subjects_delete_own on public.tutor_subjects for delete to authenticated
  using (tutor_id = (select auth.uid()));

-- ---------- Grants (Supabase dá ALL por padrão; aqui fica o mínimo) ----------
revoke all on table public.profiles, public.plans, public.subjects, public.tutor_profiles, public.tutor_subjects
  from anon, authenticated;
grant select on table public.profiles, public.plans, public.subjects, public.tutor_profiles, public.tutor_subjects
  to anon, authenticated;
grant update (full_name, avatar_path) on table public.profiles to authenticated;
grant update (slug, headline, bio, hourly_rate_cents, mode_online, mode_presencial, uf, city_ibge, city_name, published)
  on table public.tutor_profiles to authenticated;
grant insert (tutor_id, subject_id, levels), update (levels), delete on table public.tutor_subjects to authenticated;

-- Funções internas / de trigger: ninguém chama pela API.
revoke execute on function
  public.f_unaccent(text), public.slugify(text), public.short_name(text), public.set_updated_at(),
  public.tutor_before_write(), public.touch_tutor(), public.enforce_subject_limit(),
  public.create_tutor_profile(uuid, text), public.handle_new_user(), public.rate_limit()
  from public, anon, authenticated;

-- Usadas em policies (anon também: is_admin() aparece nas policies de leitura) ou pela busca pública.
revoke execute on function public.effective_plan(text, timestamptz), public.is_admin(), public.is_active_user(),
  public.plan_price(text, int), public.search_tutors(text, text, text, int, text, int, int, text, int, int),
  public.become_tutor()
  from public, anon, authenticated;
grant execute on function public.effective_plan(text, timestamptz), public.is_admin(),
  public.plan_price(text, int), public.search_tutors(text, text, text, int, text, int, int, text, int, int)
  to anon, authenticated;
grant execute on function public.is_active_user(), public.become_tutor() to authenticated;
