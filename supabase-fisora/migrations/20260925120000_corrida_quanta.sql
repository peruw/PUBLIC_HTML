-- Corrida Quanta: jogadores, corridas e ranking.
-- Projeto Supabase: fisora (login com Google compartilhado com os outros apps da Quanta).
-- Nada aqui altera tabelas ou funções existentes. Escrita só por funções SECURITY DEFINER validadas.
-- Revisado por testes de ataque e de correção (transações desfeitas) antes de aplicar.

-- ===================== Tabelas =====================
create table if not exists public.corrida_players (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  nickname         text,
  progress         jsonb  not null default '{}'::jsonb,
  revision         bigint not null default 0,
  best_score       integer not null default 0,
  best_at          timestamptz,
  run_id           uuid,
  run_started_at   timestamptz,
  nick_changed_at  timestamptz,
  progress_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint corrida_players_nickname_len check (nickname is null or char_length(nickname) between 3 and 16),
  constraint corrida_players_progress_obj check (jsonb_typeof(progress) = 'object')
);
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

-- melhor pontuação de cada jogador por semana (o ranking semanal lê só daqui)
create table if not exists public.corrida_week_best (
  week_start  timestamptz not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  score       integer not null,
  skin        text not null,
  achieved_at timestamptz not null,
  primary key (week_start, user_id)
);
create index if not exists corrida_week_best_rank_idx on public.corrida_week_best (week_start, score desc, achieved_at);

alter table public.corrida_players enable row level security;
alter table public.corrida_runs enable row level security;
alter table public.corrida_week_best enable row level security;

revoke all on public.corrida_players from anon, authenticated;
revoke all on public.corrida_runs from anon, authenticated;
revoke all on public.corrida_week_best from anon, authenticated;
grant select on public.corrida_players to authenticated;
grant select on public.corrida_runs to authenticated;

drop policy if exists corrida_players_read_own on public.corrida_players;
create policy corrida_players_read_own on public.corrida_players
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists corrida_runs_read_own on public.corrida_runs;
create policy corrida_runs_read_own on public.corrida_runs
  for select to authenticated using (user_id = (select auth.uid()));

-- ===================== Apelidos =====================
-- sem acento, só a-z, leetspeak comum convertido
create or replace function public.corrida_nick_normalize(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäåæéèêëíìîïóòôõöøúùûüçñýÿðþß0134578@$',
      'aaaaaaaeeeeiiiioooooouuuucnyydpsoieastbas'),
    '[^a-z]', '', 'g');
$$;

-- "esqueleto": l vira i e letras repetidas colapsam (caraaaIho -> caraiho)
create or replace function public.corrida_nick_skeleton(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(translate(public.corrida_nick_normalize(p), 'l', 'i'), '(.)\1+', '\1', 'g');
$$;

-- palavrões e nomes reservados; antes, remove palavras inocentes que contêm trechos proibidos
create or replace function public.corrida_nick_blocked(p text)
returns boolean language sql immutable set search_path = '' as $$
  with s as (
    select regexp_replace(public.corrida_nick_normalize(p),
      'comput|deputad|reputac|disput|amput|imput|abundan|respeitos|notari|rotari|hotari|botari|nazir|'
      || 'yoshit|matsushit|shiitak|shitak|mushit|tashit|cocktail|cockpit|peacock|hitchcock|hancock|babcock|'
      || 'dickens|dickson|benedick|badminton|padmin|alpenis|openis|happenis|pussycat|enviad|desviad|aviad|invadia|evadia',
      '', 'g') as n
  )
  select s.n ~ '(kct|krl|pqp|vsf|tnc|fdp)'
      or exists (
        select 1 from unnest(array[
          'porra','caralh','merda','puta','bucet','foda','viado','viadao','viadinho','bosta','piroca','cacete',
          'arrombad','vagabund','desgrac','otari','idiot','imbecil','retardad','nazi','hitler','sexo','sexy','porn',
          'xoxota','punhet','corno','vadia','piranha','fuck','shit','bitch','dick','cock','pussy','nigg','traveco',
          'estupr','penis','vagina','cuzao','cuzinho','peitos','bunda','admin','moderador','quanta','oficial','suporte']) w
        where strpos(public.corrida_nick_skeleton(s.n), public.corrida_nick_skeleton(w)) > 0)
  from s;
$$;

-- chave de identidade: apelidos que parecem iguais (Ana/ANA/Ána/A_na, SamueI/Samuel) colidem
create or replace function public.corrida_nick_key(p text)
returns text language sql immutable set search_path = '' as $$
  select translate(regexp_replace(
    translate(lower(p),
      'áàâãäåæéèêëíìîïóòôõöøúùûüçñýÿðþß',
      'aaaaaaaeeeeiiiioooooouuuucnyydps'),
    '[[:space:]_]', '', 'g'), 'l10', 'iio');
$$;
create unique index if not exists corrida_players_nick_key
  on public.corrida_players (public.corrida_nick_key(nickname)) where nickname is not null;

-- ===================== Regras do jogo (espelham corrida/index.html) =====================
-- pontos máximos de uma sequência de l acertos: 20 (resposta rápida) x min(10, 1 + combo/3) x 2 na febre (combo >= 15)
create or replace function public.corrida_streak_max(l integer)
returns integer language sql immutable set search_path = '' as $$
  select case when l <= 0 then 0 when l >= 26 then 400 * l - 5920
    else (array[20,40,80,120,160,220,280,340,420,500,580,680,780,880,1120,1360,1600,1880,2160,2440,2760,3080,3400,3760,4120])[l] end;
$$;
-- tempo mínimo: cada portal percorre 99,6 u a min(46, 16 + 1,1 x acertos) u/s
create or replace function public.corrida_min_duration_ms(h integer)
returns bigint language sql immutable set search_path = '' as $$
  select (coalesce((select sum(99600 / least(46, 16 + 1.1 * i)) from generate_series(0, least(h, 28) - 1) i), 0)
          + greatest(h - 28, 0) * 99600 / 46.0)::bigint;
$$;

-- ===================== RPCs =====================
-- Dados do jogador logado (cria a linha na primeira vez).
create or replace function public.corrida_get_me()
returns jsonb language plpgsql security definer set search_path = '' as $$
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

-- Apelido público: 3-16 caracteres, letras/números/espaço/_ , único, sem palavrões, 1 troca a cada 30 s.
create or replace function public.corrida_set_nickname(p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  nick text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
  last_change timestamptz;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'anonymous');
  end if;
  if char_length(nick) < 3 or char_length(nick) > 16
     or nick !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]+$'
     or char_length(public.corrida_nick_normalize(nick)) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if public.corrida_nick_blocked(nick) then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;
  select nick_changed_at into last_change from public.corrida_players where user_id = uid;
  if last_change > now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  if exists (select 1 from public.corrida_players
              where nickname is not null and public.corrida_nick_key(nickname) = public.corrida_nick_key(nick)
                and user_id <> uid) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  insert into public.corrida_players (user_id, nickname, nick_changed_at) values (uid, nick, now())
    on conflict (user_id) do update set nickname = excluded.nickname, nick_changed_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'nickname', nick);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'taken');
end;
$$;

-- Progresso (skins, XP) com revisão otimista; no máximo 1 gravação a cada 2 s.
create or replace function public.corrida_save_progress(p_progress jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cur bigint;
  last_at timestamptz;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_progress is null or jsonb_typeof(p_progress) <> 'object' or octet_length(p_progress::text) > 16384
     or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid progress request' using errcode = '22023';
  end if;
  insert into public.corrida_players (user_id) values (uid) on conflict (user_id) do nothing;
  select revision, progress_at into cur, last_at from public.corrida_players where user_id = uid for update;
  if last_at > now() - interval '2 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast', 'revision', cur);
  end if;
  if cur <> p_expected_revision then
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', cur);
  end if;
  update public.corrida_players
     set progress = p_progress, revision = cur + 1, progress_at = now(), updated_at = now()
   where user_id = uid;
  return jsonb_build_object('ok', true, 'revision', cur + 1);
end;
$$;

-- Bilhete de uso único emitido no início de cada corrida (o servidor guarda a hora de início).
create or replace function public.corrida_start_run()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  rid uuid := gen_random_uuid();
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  insert into public.corrida_players (user_id, run_id, run_started_at) values (uid, rid, now())
    on conflict (user_id) do update set run_id = excluded.run_id, run_started_at = excluded.run_started_at;
  return rid;
end;
$$;

-- Registra uma corrida: confere o bilhete, o tempo real e se os números são possíveis no jogo.
create or replace function public.corrida_submit_run(
  p_run_id uuid, p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
  p_max_speed numeric, p_duration_ms integer, p_skin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  last_at timestamptz;
  day_count integer;
  new_best integer;
  has_nick boolean;
  v_week timestamptz := date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  rank_all integer;
  rank_week integer;
  week_best integer;
  v_run uuid;
  v_started timestamptz;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'anonymous');
  end if;
  if p_run_id is null or p_score is null or p_hits is null or p_max_level is null or p_max_combo is null
     or p_max_speed is null or p_duration_ms is null or p_skin is null
     or p_hits < 0 or p_hits > 20000 or p_score < 0 or p_score > 2000000 or p_score % 10 <> 0
     or p_max_combo < 0 or p_max_combo > p_hits
     or (p_hits > 0 and (p_max_combo < 1 or p_hits > 3 * p_max_combo))      -- 3 vidas => no máximo 3 sequências
     or p_score < p_hits::bigint * 10
     or p_score > public.corrida_streak_max(p_max_combo)
                + public.corrida_streak_max(least(p_max_combo, p_hits - p_max_combo))
                + public.corrida_streak_max(least(p_max_combo, greatest(p_hits - 2 * p_max_combo, 0)))
     or p_max_level <> 1 + p_hits / 5
     or abs(p_max_speed - least(46, 16 + 1.1 * p_hits) / 16) > 0.011
     or p_duration_ms < public.corrida_min_duration_ms(p_hits) * 0.95
     or p_duration_ms > 6 * 3600 * 1000
     or p_skin !~ '^[a-z0-9-]{1,24}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('corrida_submit:' || uid::text, 0));
  select run_id, run_started_at into v_run, v_started from public.corrida_players where user_id = uid for update;
  if v_run is distinct from p_run_id then
    return jsonb_build_object('ok', false, 'error', 'no_run');
  end if;
  update public.corrida_players set run_id = null where user_id = uid;   -- bilhete de uso único
  if p_duration_ms > extract(epoch from now() - v_started) * 1000 + 3000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select max(created_at), count(*) into last_at, day_count
    from public.corrida_runs where user_id = uid and created_at > now() - interval '1 day';
  if last_at is not null and last_at > now() - interval '5 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  if day_count >= 500 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  insert into public.corrida_runs (user_id, score, hits, max_level, max_combo, max_speed, duration_ms, skin)
    values (uid, p_score, p_hits, p_max_level, p_max_combo, round(p_max_speed, 2), p_duration_ms, p_skin);
  insert into public.corrida_week_best as w (week_start, user_id, score, skin, achieved_at)
    values (v_week, uid, p_score, p_skin, now())
    on conflict (week_start, user_id) do update
      set score = excluded.score, skin = excluded.skin, achieved_at = excluded.achieved_at
      where excluded.score > w.score;

  update public.corrida_players
     set best_score = greatest(best_score, p_score),
         best_at = case when p_score > best_score then now() else best_at end,
         updated_at = now()
   where user_id = uid
  returning best_score, nickname is not null into new_best, has_nick;

  select count(*) + 1 into rank_all from public.corrida_players
   where nickname is not null and best_score > new_best;
  select w.score into week_best from public.corrida_week_best w where w.week_start = v_week and w.user_id = uid;
  select count(*) + 1 into rank_week from public.corrida_week_best w
    join public.corrida_players p on p.user_id = w.user_id and p.nickname is not null
   where w.week_start = v_week and w.score > week_best;

  -- sem apelido ou sem pontos, a pessoa não aparece no ranking: não devolve posição
  return jsonb_build_object('ok', true, 'best', new_best, 'week_best', week_best,
    'rank_all',  case when has_nick and new_best  > 0 then rank_all  end,
    'rank_week', case when has_nick and week_best > 0 then rank_week end);
end;
$$;

-- Ranking público: só apelido, pontos e skin. p_period: 'week' ou 'all'.
create or replace function public.corrida_leaderboard(p_period text default 'week', p_limit integer default 20)
returns table (rank integer, nickname text, score integer, skin text, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_week timestamptz := date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
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
    with ranked as (
      select (rank() over (order by w.score desc))::integer as rk, w.user_id as uid_, w.score as sc, w.skin as sk,
             p.nickname as nick,
             row_number() over (order by w.score desc, w.achieved_at asc, w.user_id) as pos
        from public.corrida_week_best w
        join public.corrida_players p on p.user_id = w.user_id and p.nickname is not null
       where w.week_start = v_week and w.score > 0
    )
    select k.rk, k.nick, k.sc, k.sk, coalesce(k.uid_ = uid, false)
      from ranked k
     where k.pos <= lim or k.uid_ = uid
     order by k.pos;
  end if;
end;
$$;

-- ===================== Permissões =====================
revoke all on function public.corrida_nick_normalize(text) from public, anon, authenticated;
revoke all on function public.corrida_nick_skeleton(text) from public, anon, authenticated;
revoke all on function public.corrida_nick_blocked(text) from public, anon, authenticated;
revoke all on function public.corrida_nick_key(text) from public, anon, authenticated;
revoke all on function public.corrida_streak_max(integer) from public, anon, authenticated;
revoke all on function public.corrida_min_duration_ms(integer) from public, anon, authenticated;
revoke all on function public.corrida_get_me() from public, anon;
revoke all on function public.corrida_set_nickname(text) from public, anon;
revoke all on function public.corrida_save_progress(jsonb, bigint) from public, anon;
revoke all on function public.corrida_start_run() from public, anon;
revoke all on function public.corrida_submit_run(uuid, integer, integer, integer, integer, numeric, integer, text) from public, anon;
revoke all on function public.corrida_leaderboard(text, integer) from public;

grant execute on function public.corrida_get_me() to authenticated;
grant execute on function public.corrida_set_nickname(text) to authenticated;
grant execute on function public.corrida_save_progress(jsonb, bigint) to authenticated;
grant execute on function public.corrida_start_run() to authenticated;
grant execute on function public.corrida_submit_run(uuid, integer, integer, integer, integer, numeric, integer, text) to authenticated;
grant execute on function public.corrida_leaderboard(text, integer) to anon, authenticated;
