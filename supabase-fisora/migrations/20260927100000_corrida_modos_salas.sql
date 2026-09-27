-- Corrida Quanta: ranking por modo (Matemática, Química, Física) e salas de turma.
-- Projeto Supabase: fisora. Só toca nas tabelas e funções da Corrida.
-- Escrita continua só por funções SECURITY DEFINER validadas; tabelas sem acesso direto.

-- ===================== Ranking por modo =====================
alter table public.corrida_runs add column if not exists mode text not null default 'mat';
alter table public.corrida_runs drop constraint if exists corrida_runs_mode_check;
alter table public.corrida_runs add constraint corrida_runs_mode_check check (mode in ('mat', 'quim', 'fis'));

-- melhor pontuação de cada jogador em cada modo (o ranking geral lê daqui)
create table if not exists public.corrida_mode_best (
  mode        text not null check (mode in ('mat', 'quim', 'fis')),
  user_id     uuid not null references auth.users (id) on delete cascade,
  score       integer not null,
  skin        text not null,
  achieved_at timestamptz not null,
  primary key (mode, user_id)
);
create index if not exists corrida_mode_best_rank_idx on public.corrida_mode_best (mode, score desc, achieved_at);
alter table public.corrida_mode_best enable row level security;
revoke all on public.corrida_mode_best from anon, authenticated;

-- recordes antigos (todos de Matemática) entram no ranking do modo
insert into public.corrida_mode_best (mode, user_id, score, skin, achieved_at)
select 'mat', p.user_id, p.best_score,
       coalesce((select r.skin from public.corrida_runs r where r.user_id = p.user_id order by r.score desc, r.created_at asc limit 1), 'quanta'),
       coalesce(p.best_at, now())
  from public.corrida_players p
 where p.best_score > 0
on conflict do nothing;

alter table public.corrida_week_best add column if not exists mode text not null default 'mat';
alter table public.corrida_week_best drop constraint if exists corrida_week_best_mode_check;
alter table public.corrida_week_best add constraint corrida_week_best_mode_check check (mode in ('mat', 'quim', 'fis'));
alter table public.corrida_week_best drop constraint if exists corrida_week_best_pkey;
alter table public.corrida_week_best add primary key (week_start, mode, user_id);
drop index if exists public.corrida_week_best_rank_idx;
create index if not exists corrida_week_best_rank_idx on public.corrida_week_best (week_start, mode, score desc, achieved_at);

-- velocidade inicial, aumento por acerto e máximo de cada modo (iguais aos de js/modes.js)
create or replace function public.corrida_mode_speed(p_mode text, out v_start numeric, out v_step numeric, out v_max numeric)
returns record language sql immutable set search_path = '' as $$
  select case p_mode when 'quim' then 12 when 'fis' then 11 else 16 end::numeric,
         case p_mode when 'quim' then 0.8 when 'fis' then 0.7 else 1.1 end::numeric,
         case p_mode when 'quim' then 32 when 'fis' then 28 else 46 end::numeric;
$$;

-- menor tempo possível de uma corrida com h acertos, com dash o tempo todo (velocidade + 80)
create or replace function public.corrida_min_duration_ms(h integer, p_mode text)
returns bigint language sql immutable set search_path = '' as $$
  with s as (select v_start, v_step, v_max, ceil((v_max - v_start) / v_step)::integer as n0 from public.corrida_mode_speed(p_mode))
  select (coalesce((select sum(99600 / (least(s.v_max, s.v_start + s.v_step * i) + 80))
                      from s, generate_series(0, least(h, s.n0) - 1) i), 0)
          + (select greatest(h - s.n0, 0) * 99600 / (s.v_max + 80) from s))::bigint;
$$;

-- os números de uma corrida são possíveis no jogo?
create or replace function public.corrida_check_run(
  p_mode text, p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
  p_max_speed numeric, p_duration_ms integer, p_skin text)
returns boolean language sql immutable set search_path = '' as $$
  select p_mode in ('mat', 'quim', 'fis')
     and p_score is not null and p_hits is not null and p_max_level is not null and p_max_combo is not null
     and p_max_speed is not null and p_duration_ms is not null and p_skin is not null
     and not (
       p_hits < 0 or p_hits > 20000 or p_score < 0 or p_score > 2000000 or p_score % 10 <> 0
       or p_max_combo < 0 or p_max_combo > p_hits
       or (p_hits > 0 and (p_max_combo < 1 or p_hits > 3 * p_max_combo))      -- 3 vidas => no máximo 3 sequências
       or p_score < p_hits::bigint * 10
       or p_score > public.corrida_streak_max(p_max_combo)
                  + public.corrida_streak_max(least(p_max_combo, p_hits - p_max_combo))
                  + public.corrida_streak_max(least(p_max_combo, greatest(p_hits - 2 * p_max_combo, 0)))
       or p_max_level <> 1 + p_hits / 5
       or abs(p_max_speed - least(s.v_max, s.v_start + s.v_step * p_hits) / s.v_start) > 0.011
       or p_duration_ms < public.corrida_min_duration_ms(p_hits, p_mode) * 0.95
       or p_duration_ms > 6 * 3600 * 1000
       or p_skin !~ '^[a-z0-9-]{1,24}$')
    from public.corrida_mode_speed(p_mode) s;
$$;

-- Registra uma corrida no modo: confere o bilhete, o tempo real e se os números são possíveis.
create or replace function public.corrida_submit_run(
  p_run_id uuid, p_mode text, p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
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
  if p_run_id is null or not public.corrida_check_run(p_mode, p_score, p_hits, p_max_level, p_max_combo, p_max_speed, p_duration_ms, p_skin) then
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

  insert into public.corrida_runs (user_id, mode, score, hits, max_level, max_combo, max_speed, duration_ms, skin)
    values (uid, p_mode, p_score, p_hits, p_max_level, p_max_combo, round(p_max_speed, 2), p_duration_ms, p_skin);
  insert into public.corrida_week_best as w (week_start, mode, user_id, score, skin, achieved_at)
    values (v_week, p_mode, uid, p_score, p_skin, now())
    on conflict (week_start, mode, user_id) do update
      set score = excluded.score, skin = excluded.skin, achieved_at = excluded.achieved_at
      where excluded.score > w.score;
  insert into public.corrida_mode_best as b (mode, user_id, score, skin, achieved_at)
    values (p_mode, uid, p_score, p_skin, now())
    on conflict (mode, user_id) do update
      set score = excluded.score, skin = excluded.skin, achieved_at = excluded.achieved_at
      where excluded.score > b.score;

  -- best_score em corrida_players continua sendo o recorde de Matemática (o modo original)
  if p_mode = 'mat' then
    update public.corrida_players
       set best_score = greatest(best_score, p_score),
           best_at = case when p_score > best_score then now() else best_at end,
           updated_at = now()
     where user_id = uid;
  end if;
  select b.score, p.nickname is not null into new_best, has_nick
    from public.corrida_mode_best b join public.corrida_players p on p.user_id = b.user_id
   where b.mode = p_mode and b.user_id = uid;

  select count(*) + 1 into rank_all from public.corrida_mode_best b
    join public.corrida_players p on p.user_id = b.user_id and p.nickname is not null
   where b.mode = p_mode and b.score > new_best;
  select w.score into week_best from public.corrida_week_best w where w.week_start = v_week and w.mode = p_mode and w.user_id = uid;
  select count(*) + 1 into rank_week from public.corrida_week_best w
    join public.corrida_players p on p.user_id = w.user_id and p.nickname is not null
   where w.week_start = v_week and w.mode = p_mode and w.score > week_best;

  -- sem apelido ou sem pontos, a pessoa não aparece no ranking: não devolve posição
  return jsonb_build_object('ok', true, 'best', new_best, 'week_best', week_best,
    'rank_all',  case when has_nick and new_best  > 0 then rank_all  end,
    'rank_week', case when has_nick and week_best > 0 then rank_week end);
end;
$$;

-- assinatura antiga (clientes ainda em cache): Matemática
create or replace function public.corrida_submit_run(
  p_run_id uuid, p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
  p_max_speed numeric, p_duration_ms integer, p_skin text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.corrida_submit_run(p_run_id, 'mat', p_score, p_hits, p_max_level, p_max_combo, p_max_speed, p_duration_ms, p_skin);
$$;

-- Ranking do modo: semana (fuso de São Paulo) ou geral. Quem está logado sempre aparece, mesmo fora do topo.
-- (a versão de 2 argumentos sai antes, senão a chamada com 2 argumentos fica ambígua)
drop function if exists public.corrida_leaderboard(text, integer);
create or replace function public.corrida_leaderboard(p_period text default 'week', p_limit integer default 20, p_mode text default 'mat')
returns table (rank integer, nickname text, score integer, skin text, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_mode text := case when p_mode in ('mat', 'quim', 'fis') then p_mode else 'mat' end;
  v_week timestamptz := date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if p_period = 'all' then
    return query
    with ranked as (
      select (rank() over (order by b.score desc))::integer as rk, p.nickname as nick,
             b.score as sc, b.skin as sk, b.user_id as uid_,
             row_number() over (order by b.score desc, b.achieved_at asc, b.user_id) as pos
        from public.corrida_mode_best b
        join public.corrida_players p on p.user_id = b.user_id and p.nickname is not null
       where b.mode = v_mode and b.score > 0
    )
    select k.rk, k.nick, k.sc, k.sk, coalesce(k.uid_ = uid, false)
      from ranked k
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
       where w.week_start = v_week and w.mode = v_mode and w.score > 0
    )
    select k.rk, k.nick, k.sc, k.sk, coalesce(k.uid_ = uid, false)
      from ranked k
     where k.pos <= lim or k.uid_ = uid
     order by k.pos;
  end if;
end;
$$;

-- ===================== Salas de turma =====================
-- O professor cria a sala (código de 5 letras); os alunos entram pelo link, jogam as mesmas perguntas
-- (semente da sala) e o resultado vai para a sala. Sem conta, o aluno participa como convidado.
create table if not exists public.corrida_rooms (
  code        text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  mode        text not null,
  seed        integer not null,
  open        boolean not null default true,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  constraint corrida_rooms_code_chk check (code ~ '^[A-Z0-9]{5}$'),
  constraint corrida_rooms_name_chk check (char_length(name) between 2 and 40),
  constraint corrida_rooms_mode_chk check (mode in ('mat', 'quim', 'fis'))
);
create index if not exists corrida_rooms_owner_idx on public.corrida_rooms (owner_id, created_at desc);

create table if not exists public.corrida_room_runs (
  id           bigint generated always as identity primary key,
  code         text not null references public.corrida_rooms (code) on delete cascade,
  user_id      uuid references auth.users (id) on delete cascade,
  guest_id     uuid,
  player_name  text not null,
  score        integer not null,
  hits         integer not null,
  max_level    integer not null,
  max_combo    integer not null,
  duration_ms  integer not null,
  misses       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  constraint corrida_room_runs_who_chk check (user_id is not null or guest_id is not null),
  constraint corrida_room_runs_name_chk check (char_length(player_name) between 1 and 24),
  constraint corrida_room_runs_misses_chk check (jsonb_typeof(misses) = 'array')
);
create index if not exists corrida_room_runs_code_idx on public.corrida_room_runs (code, score desc);
create index if not exists corrida_room_runs_who_idx on public.corrida_room_runs (code, coalesce(user_id, guest_id), created_at desc);

alter table public.corrida_rooms enable row level security;
alter table public.corrida_room_runs enable row level security;
revoke all on public.corrida_rooms from anon, authenticated;
revoke all on public.corrida_room_runs from anon, authenticated;

-- nome de sala ou de convidado: letras, números, espaço e pouca pontuação; sem palavrão
create or replace function public.corrida_room_clean_name(p text, p_max integer)
returns text language sql immutable set search_path = '' as $$
  with s as (select btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')) as n)
  select case when char_length(s.n) between 2 and p_max and s.n ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9_ .!?ºª-]+$'
                   and not public.corrida_nick_blocked(s.n) then s.n end
    from s;
$$;

create or replace function public.corrida_room_create(p_name text, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  nm text := public.corrida_room_clean_name(p_name, 40);
  v_code text;
  tries integer := 0;
  alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  n_active integer;
  last_at timestamptz;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'anonymous');
  end if;
  if nm is null or p_mode not in ('mat', 'quim', 'fis') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select count(*), max(created_at) into n_active, last_at from public.corrida_rooms where owner_id = uid and expires_at > now();
  if last_at > now() - interval '10 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  if n_active >= 30 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  loop
    select string_agg(substr(alpha, 1 + floor(random() * length(alpha))::integer, 1), '') into v_code from generate_series(1, 5);
    exit when not exists (select 1 from public.corrida_rooms r where r.code = v_code);
    tries := tries + 1;
    if tries > 20 then raise exception 'Could not allocate a room code'; end if;
  end loop;
  insert into public.corrida_rooms (code, owner_id, name, mode, seed)
    values (v_code, uid, nm, p_mode, floor(random() * 2147483647)::integer);
  return jsonb_build_object('ok', true, 'code', v_code, 'name', nm, 'mode', p_mode);
end;
$$;

-- dados públicos da sala (qualquer pessoa com o código); null se não existe
create or replace function public.corrida_room_get(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.corrida_rooms%rowtype;
  parts integer;
begin
  select * into r from public.corrida_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select count(distinct coalesce(user_id, guest_id)) into parts from public.corrida_room_runs where code = r.code;
  return jsonb_build_object('code', r.code, 'name', r.name, 'mode', r.mode, 'seed', r.seed,
    'owner', coalesce(r.owner_id = uid, false), 'participants', parts,
    'open', r.open and r.expires_at > now(), 'created_at', r.created_at, 'expires_at', r.expires_at);
end;
$$;

-- resultado de uma corrida na sala (com conta: identidade da conta; sem conta: nome + id do aparelho)
create or replace function public.corrida_room_submit(
  p_code text, p_name text, p_guest_id uuid, p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
  p_max_speed numeric, p_duration_ms integer, p_skin text, p_misses jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.corrida_rooms%rowtype;
  v_who uuid;
  v_guest uuid;
  nm text;
  nick text;
  last_at timestamptz;
  n_runs integer;
  n_room integer;
  v_best integer;
  v_rank integer;
  v_parts integer;
begin
  select * into r from public.corrida_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not r.open or r.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if uid is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then uid := null; end if;
  if uid is not null then
    select nickname into nick from public.corrida_players where user_id = uid;
    v_who := uid;
  else
    if p_guest_id is null then return jsonb_build_object('ok', false, 'error', 'anonymous'); end if;
    v_who := p_guest_id; v_guest := p_guest_id;
  end if;
  nm := public.corrida_room_clean_name(coalesce(nick, p_name), 24);
  if nm is null then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  if not public.corrida_check_run(r.mode, p_score, p_hits, p_max_level, p_max_combo, p_max_speed, p_duration_ms, p_skin) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if p_misses is null or jsonb_typeof(p_misses) <> 'array' or jsonb_array_length(p_misses) > 60 or octet_length(p_misses::text) > 16384
     or exists (select 1 from jsonb_array_elements(p_misses) e
                 where jsonb_typeof(e) <> 'object'
                    or char_length(coalesce(e ->> 'k', '')) not between 1 and 80
                    or char_length(coalesce(e ->> 't', '')) > 80 or char_length(coalesce(e ->> 'x', '')) > 80
                    or char_length(coalesce(e ->> 'a', '')) > 40) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('corrida_room:' || r.code, 0));
  select max(created_at), count(*) into last_at, n_runs
    from public.corrida_room_runs where code = r.code and coalesce(user_id, guest_id) = v_who;
  if last_at is not null and last_at > now() - interval '5 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  select count(*) into n_room from public.corrida_room_runs where code = r.code;
  if n_runs >= 200 or n_room >= 5000 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  insert into public.corrida_room_runs (code, user_id, guest_id, player_name, score, hits, max_level, max_combo, duration_ms, misses)
    values (r.code, uid, v_guest, nm, p_score, p_hits, p_max_level, p_max_combo, p_duration_ms,
            (select coalesce(jsonb_agg(jsonb_build_object('k', e ->> 'k', 't', coalesce(e ->> 't', ''), 'x', coalesce(e ->> 'x', ''), 'a', coalesce(e ->> 'a', ''))), '[]'::jsonb)
               from jsonb_array_elements(p_misses) e));

  with best as (
    select coalesce(user_id, guest_id) as who, max(score) as sc from public.corrida_room_runs where code = r.code group by 1
  )
  select (select sc from best where who = v_who), count(*), (select count(*) + 1 from best b2 where b2.sc > (select sc from best where who = v_who))
    into v_best, v_parts, v_rank
    from best;
  return jsonb_build_object('ok', true, 'rank', v_rank, 'participants', v_parts, 'best', v_best, 'name', nm);
end;
$$;

-- relatório da sala: só quem criou. Melhor resultado de cada participante e perguntas mais erradas.
create or replace function public.corrida_room_report(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.corrida_rooms%rowtype;
  v_players jsonb;
  v_misses jsonb;
  v_runs integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into r from public.corrida_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.owner_id <> uid then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  with runs as (
    select coalesce(user_id, guest_id) as who, user_id, player_name, score, hits, max_combo, max_level, created_at, misses
      from public.corrida_room_runs where code = r.code
  ), best as (
    select distinct on (who) who, user_id, player_name, score, hits, max_combo, max_level, created_at
      from runs order by who, score desc, created_at asc
  ), cnt as (
    select who, count(*) as n, max(created_at) as last_at from runs group by who
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', b.player_name, 'score', b.score, 'hits', b.hits, 'combo', b.max_combo, 'level', b.max_level,
           'runs', c.n, 'last_at', c.last_at, 'guest', b.user_id is null)
           order by b.score desc, b.created_at asc), '[]'::jsonb), sum(c.n)::integer
    into v_players, v_runs
    from best b join cnt c on c.who = b.who;

  with runs as (
    select coalesce(user_id, guest_id) as who, misses from public.corrida_room_runs where code = r.code
  ), m as (
    select who, e ->> 'k' as k, e ->> 't' as t, e ->> 'x' as x, e ->> 'a' as a from runs, jsonb_array_elements(misses) e
  ), agg as (
    select k, min(t) as t, min(x) as x, min(a) as a, count(distinct who)::integer as students, count(*)::integer as total
      from m group by k order by students desc, total desc, k limit 15
  )
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 't', t, 'x', x, 'a', a, 'students', students, 'total', total)
           order by students desc, total desc, k), '[]'::jsonb)
    into v_misses from agg;

  return jsonb_build_object('ok', true,
    'room', jsonb_build_object('code', r.code, 'name', r.name, 'mode', r.mode, 'open', r.open and r.expires_at > now(),
                               'created_at', r.created_at, 'expires_at', r.expires_at, 'runs', coalesce(v_runs, 0)),
    'players', v_players, 'misses', v_misses);
end;
$$;

-- salas de quem está logado
create or replace function public.corrida_room_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_out jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', r.code, 'name', r.name, 'mode', r.mode, 'open', r.open and r.expires_at > now(), 'created_at', r.created_at,
           'participants', (select count(distinct coalesce(x.user_id, x.guest_id)) from public.corrida_room_runs x where x.code = r.code),
           'runs', (select count(*) from public.corrida_room_runs x where x.code = r.code))
           order by r.created_at desc), '[]'::jsonb)
    into v_out
    from public.corrida_rooms r where r.owner_id = uid and r.expires_at > now() - interval '60 days';
  return v_out;
end;
$$;

-- abre ou fecha a sala para novos resultados (só quem criou)
create or replace function public.corrida_room_close(p_code text, p_open boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  update public.corrida_rooms set open = coalesce(p_open, false) where code = upper(btrim(coalesce(p_code, ''))) and owner_id = uid;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'open', coalesce(p_open, false));
end;
$$;

-- ===================== Permissões =====================
revoke all on function public.corrida_mode_speed(text) from public, anon, authenticated;
revoke all on function public.corrida_min_duration_ms(integer, text) from public, anon, authenticated;
revoke all on function public.corrida_check_run(text, integer, integer, integer, integer, numeric, integer, text) from public, anon, authenticated;
revoke all on function public.corrida_room_clean_name(text, integer) from public, anon, authenticated;
revoke all on function public.corrida_submit_run(uuid, text, integer, integer, integer, integer, numeric, integer, text) from public, anon;
revoke all on function public.corrida_submit_run(uuid, integer, integer, integer, integer, numeric, integer, text) from public, anon;
revoke all on function public.corrida_leaderboard(text, integer, text) from public;
revoke all on function public.corrida_room_create(text, text) from public, anon;
revoke all on function public.corrida_room_get(text) from public;
revoke all on function public.corrida_room_submit(text, text, uuid, integer, integer, integer, integer, numeric, integer, text, jsonb) from public;
revoke all on function public.corrida_room_report(text) from public, anon;
revoke all on function public.corrida_room_list() from public, anon;
revoke all on function public.corrida_room_close(text, boolean) from public, anon;

grant execute on function public.corrida_submit_run(uuid, text, integer, integer, integer, integer, numeric, integer, text) to authenticated;
grant execute on function public.corrida_submit_run(uuid, integer, integer, integer, integer, numeric, integer, text) to authenticated;
grant execute on function public.corrida_leaderboard(text, integer, text) to anon, authenticated;
grant execute on function public.corrida_room_create(text, text) to authenticated;
grant execute on function public.corrida_room_get(text) to anon, authenticated;
grant execute on function public.corrida_room_submit(text, text, uuid, integer, integer, integer, integer, numeric, integer, text, jsonb) to anon, authenticated;
grant execute on function public.corrida_room_report(text) to authenticated;
grant execute on function public.corrida_room_list() to authenticated;
grant execute on function public.corrida_room_close(text, boolean) to authenticated;

-- a função antiga de tempo mínimo (só Matemática) some
drop function if exists public.corrida_min_duration_ms(integer);
