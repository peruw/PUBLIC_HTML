-- Corrida Quanta: jogadores, corridas e ranking.
-- Projeto Supabase: fisora (login com Google compartilhado com os outros apps da Quanta).
-- Nada aqui altera tabelas ou funções existentes. Escrita só por funções SECURITY DEFINER validadas.

-- ===================== Tabelas =====================
create table if not exists public.corrida_players (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  nickname    text,
  progress    jsonb  not null default '{}'::jsonb,
  revision    bigint not null default 0,
  best_score  integer not null default 0,
  best_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint corrida_players_nickname_len check (nickname is null or char_length(nickname) between 3 and 16),
  constraint corrida_players_progress_obj check (jsonb_typeof(progress) = 'object')
);
create unique index if not exists corrida_players_nickname_key on public.corrida_players (lower(nickname));
create index if not exists corrida_players_best_idx on public.corrida_players (best_score desc, best_at asc) where nickname is not null;

create table if not exists public.corrida_runs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  score        integer not null,
  hits         integer not null,
  max_level    integer not null,
  max_combo    integer not null,
  max_speed    numeric(4, 2) not null,
  duration_ms  integer not null,
  skin         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists corrida_runs_user_idx on public.corrida_runs (user_id, created_at desc);
create index if not exists corrida_runs_week_idx on public.corrida_runs (created_at desc, score desc);

alter table public.corrida_players enable row level security;
alter table public.corrida_runs enable row level security;

revoke all on public.corrida_players from anon, authenticated;
revoke all on public.corrida_runs from anon, authenticated;
grant select on public.corrida_players to authenticated;
grant select on public.corrida_runs to authenticated;

drop policy if exists corrida_players_read_own on public.corrida_players;
create policy corrida_players_read_own on public.corrida_players
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists corrida_runs_read_own on public.corrida_runs;
create policy corrida_runs_read_own on public.corrida_runs
  for select to authenticated using (user_id = (select auth.uid()));

-- ===================== Funções auxiliares =====================
-- Normaliza apelido para o filtro de palavrões (sem acento, sem espaço, leetspeak comum).
create or replace function public.corrida_nick_normalize(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäéèêëíìîïóòôõöúùûüç0134578@$',
      'aaaaaeeeeiiiiooooouuuucoieastbas'),
    '[^a-z]', '', 'g');
$$;

create or replace function public.corrida_nick_blocked(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.corrida_nick_normalize(p) ~ (
    'porra|caralh|merda|puta|buceta|bucet|foda|fdp|viado|bosta|piroca|cacete|arrombad|vagabund|'
    || 'desgrac|otari|idiot|imbecil|retardad|nazi|hitler|sexo|sexy|porn|xoxota|punhet|corno|vadia|piranha|'
    || 'kct|krl|pqp|vsf|tnc|fuck|shit|bitch|dick|cock|pussy|nigg|traveco|estupr|'
    || 'penis|vagina|cuzao|cuzinho|peitos|bunda|admin|moderador|quantaaulas'
  );
$$;

-- ===================== RPCs =====================
-- Dados do jogador logado (cria a linha na primeira vez).
create or replace function public.corrida_get_me()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.corrida_players%rowtype;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  insert into public.corrida_players (user_id) values (uid) on conflict (user_id) do nothing;
  select * into r from public.corrida_players where user_id = uid;
  return jsonb_build_object(
    'nickname', r.nickname, 'progress', r.progress, 'revision', r.revision, 'best_score', r.best_score);
end;
$$;

-- Define o apelido público (3-16 caracteres, letras/números/espaço/_ , único, sem palavrões).
create or replace function public.corrida_set_nickname(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  nick text := regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g');
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(nick) < 3 or char_length(nick) > 16
     or nick !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]+$'
     or char_length(public.corrida_nick_normalize(nick)) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if public.corrida_nick_blocked(nick) then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;
  if exists (select 1 from public.corrida_players where lower(nickname) = lower(nick) and user_id <> uid) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  insert into public.corrida_players (user_id, nickname) values (uid, nick)
    on conflict (user_id) do update set nickname = excluded.nickname, updated_at = now();
  return jsonb_build_object('ok', true, 'nickname', nick);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'taken');
end;
$$;

-- Salva o progresso (skins, conquistas, XP) com controle de revisão otimista.
create or replace function public.corrida_save_progress(p_progress jsonb, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur bigint;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_progress is null or jsonb_typeof(p_progress) <> 'object' or octet_length(p_progress::text) > 32768
     or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid progress request' using errcode = '22023';
  end if;
  insert into public.corrida_players (user_id) values (uid) on conflict (user_id) do nothing;
  select revision into cur from public.corrida_players where user_id = uid for update;
  if cur <> p_expected_revision then
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', cur);
  end if;
  update public.corrida_players
     set progress = p_progress, revision = cur + 1, updated_at = now()
   where user_id = uid;
  return jsonb_build_object('ok', true, 'revision', cur + 1);
end;
$$;

-- Registra uma corrida. Valida se os números são possíveis no jogo e limita a frequência.
create or replace function public.corrida_submit_run(
  p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
  p_max_speed numeric, p_duration_ms integer, p_skin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  last_at timestamptz;
  day_count integer;
  new_best integer;
  week_start timestamptz := date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  rank_all integer;
  rank_week integer;
  week_best integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;

  -- limites do jogo: 10 pts por acerto (20 se rápido) x combo até x10 x2 na febre = no máximo 400;
  -- cada portal leva >= ~2,2 s para chegar;
  -- nível sobe a cada 5 acertos; velocidade máxima 46/16 = 2,875x
  if p_score is null or p_hits is null or p_max_level is null or p_max_combo is null
     or p_max_speed is null or p_duration_ms is null or p_skin is null
     or p_score < 0 or p_score > 1000000 or p_score % 10 <> 0
     or p_hits < 0 or p_hits > 20000
     or p_score > p_hits::bigint * 400
     or p_score < p_hits::bigint * 10
     or p_max_combo < 0 or p_max_combo > p_hits
     or p_max_level < 1 or p_max_level > 1 + p_hits / 5
     or p_max_speed < 1 or p_max_speed > 2.9
     or p_duration_ms < p_hits::bigint * 2000 or p_duration_ms > 6 * 3600 * 1000
     or p_skin !~ '^[a-z0-9-]{1,24}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('corrida_submit:' || uid::text, 0));
  select max(created_at), count(*) filter (where created_at > now() - interval '1 day')
    into last_at, day_count
    from public.corrida_runs where user_id = uid and created_at > now() - interval '1 day';
  if last_at is not null and last_at > now() - interval '5 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  if day_count >= 500 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  insert into public.corrida_runs (user_id, score, hits, max_level, max_combo, max_speed, duration_ms, skin)
    values (uid, p_score, p_hits, p_max_level, p_max_combo, round(p_max_speed, 2), p_duration_ms, p_skin);

  insert into public.corrida_players (user_id) values (uid) on conflict (user_id) do nothing;
  update public.corrida_players
     set best_score = greatest(best_score, p_score),
         best_at = case when p_score > best_score then now() else best_at end,
         updated_at = now()
   where user_id = uid
  returning best_score into new_best;

  select count(*) + 1 into rank_all from public.corrida_players
   where nickname is not null and best_score > new_best;
  select max(score) into week_best from public.corrida_runs where user_id = uid and created_at >= week_start;
  select count(*) + 1 into rank_week from (
    select r.user_id, max(r.score) as s from public.corrida_runs r
      join public.corrida_players p on p.user_id = r.user_id and p.nickname is not null
     where r.created_at >= week_start group by r.user_id
  ) w where w.s > week_best;

  return jsonb_build_object('ok', true, 'best', new_best, 'week_best', week_best,
    'rank_all', rank_all, 'rank_week', rank_week);
end;
$$;

-- Ranking público: só apelido, pontos e skin. p_period: 'week' ou 'all'.
create or replace function public.corrida_leaderboard(p_period text default 'week', p_limit integer default 20)
returns table (rank integer, nickname text, score integer, skin text, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  week_start timestamptz := date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if p_period = 'all' then
    return query
    with ranked as (
      select (rank() over (order by p.best_score desc))::integer as rk, p.nickname as nick,
             p.best_score as sc, p.user_id as uid_,
             row_number() over (order by p.best_score desc, p.best_at asc nulls last, p.user_id) as pos
        from public.corrida_players p
       where p.nickname is not null and p.best_score > 0
    ), best_skin as (
      select distinct on (r.user_id) r.user_id, r.skin from public.corrida_runs r
       where r.user_id in (select uid_ from ranked where pos <= lim or uid_ = uid)
       order by r.user_id, r.score desc, r.created_at asc
    )
    select k.rk, k.nick, k.sc, coalesce(b.skin, 'quanta'), coalesce(k.uid_ = uid, false)
      from ranked k left join best_skin b on b.user_id = k.uid_
     where k.pos <= lim or k.uid_ = uid
     order by k.pos;
  else
    return query
    with best as (
      select distinct on (r.user_id) r.user_id, r.score, r.skin, r.created_at
        from public.corrida_runs r
        join public.corrida_players p on p.user_id = r.user_id and p.nickname is not null
       where r.created_at >= week_start
       order by r.user_id, r.score desc, r.created_at asc
    ), ranked as (
      select (rank() over (order by b.score desc))::integer as rk, b.user_id as uid_, b.score as sc, b.skin as sk,
             row_number() over (order by b.score desc, b.created_at asc, b.user_id) as pos
        from best b where b.score > 0
    )
    select k.rk, p.nickname, k.sc, k.sk, coalesce(k.uid_ = uid, false)
      from ranked k join public.corrida_players p on p.user_id = k.uid_
     where k.pos <= lim or k.uid_ = uid
     order by k.pos;
  end if;
end;
$$;

-- ===================== Permissões =====================
revoke all on function public.corrida_nick_normalize(text) from public, anon, authenticated;
revoke all on function public.corrida_nick_blocked(text) from public, anon, authenticated;
revoke all on function public.corrida_get_me() from public, anon;
revoke all on function public.corrida_set_nickname(text) from public, anon;
revoke all on function public.corrida_save_progress(jsonb, bigint) from public, anon;
revoke all on function public.corrida_submit_run(integer, integer, integer, integer, numeric, integer, text) from public, anon;
revoke all on function public.corrida_leaderboard(text, integer) from public;

grant execute on function public.corrida_get_me() to authenticated;
grant execute on function public.corrida_set_nickname(text) to authenticated;
grant execute on function public.corrida_save_progress(jsonb, bigint) to authenticated;
grant execute on function public.corrida_submit_run(integer, integer, integer, integer, numeric, integer, text) to authenticated;
grant execute on function public.corrida_leaderboard(text, integer) to anon, authenticated;
