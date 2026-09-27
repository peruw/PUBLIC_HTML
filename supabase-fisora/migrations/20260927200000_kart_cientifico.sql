-- Kart Científico: ranking online (geral e da semana) e salas de turma.
-- Projeto Supabase: fisora (mesma conta do site, /conta/). Só cria tabelas e funções kart_*.
-- Escrita só por funções SECURITY DEFINER validadas; as tabelas não têm acesso direto.
-- Placar = TEMPO (menor é melhor), por "board": <modo>-<classe>-<voltas>, ex.: race-100cc-2, tt-150cc-3.

-- ---------- limites de cada placar ----------
-- Tempo mínimo plausível por volta (ms): ~60% da volta mais rápida medida em simulação.
create or replace function public.kart_board_limits(p_board text, out ok boolean, out laps integer, out min_lap_ms integer)
language plpgsql immutable set search_path = '' as $$
declare
  m text[];
begin
  ok := false; laps := 0; min_lap_ms := 0;
  if p_board is null then return; end if;
  m := regexp_match(p_board, '^(race|tt)-(50|100|150)cc-(1|2|3|5)$');
  if m is null then return; end if;
  laps := m[3]::integer;
  min_lap_ms := case m[2] when '50' then 50000 when '100' then 38000 else 32000 end;
  ok := true;
end;
$$;

-- ---------- jogadores e corridas ----------
create table if not exists public.kart_players (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) between 3 and 16),
  nick_changed_at timestamptz,
  run_id uuid,
  run_board text,
  run_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists kart_players_nick_key
  on public.kart_players (public.corrida_nick_key(nickname)) where nickname is not null;

create table if not exists public.kart_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  board text not null,
  time_ms integer not null check (time_ms > 0),
  best_lap_ms integer not null check (best_lap_ms > 0),
  char_id text not null,
  place smallint not null check (place between 1 and 8),
  created_at timestamptz not null default now()
);
create index if not exists kart_runs_user_idx on public.kart_runs (user_id, created_at desc);

create table if not exists public.kart_best (
  board text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  time_ms integer not null,
  best_lap_ms integer not null,
  char_id text not null,
  achieved_at timestamptz not null,
  primary key (board, user_id)
);
create index if not exists kart_best_rank_idx on public.kart_best (board, time_ms, achieved_at);

create table if not exists public.kart_week_best (
  week_start timestamptz not null,
  board text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  time_ms integer not null,
  best_lap_ms integer not null,
  char_id text not null,
  achieved_at timestamptz not null,
  primary key (week_start, board, user_id)
);
create index if not exists kart_week_best_rank_idx on public.kart_week_best (week_start, board, time_ms, achieved_at);

-- ---------- salas de turma ----------
create table if not exists public.kart_rooms (
  code        text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  board       text not null,
  open        boolean not null default true,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  constraint kart_rooms_code_chk check (code ~ '^[A-Z0-9]{5}$'),
  constraint kart_rooms_name_chk check (char_length(name) between 2 and 40)
);
create index if not exists kart_rooms_owner_idx on public.kart_rooms (owner_id, created_at desc);

create table if not exists public.kart_room_runs (
  id           bigint generated always as identity primary key,
  code         text not null references public.kart_rooms (code) on delete cascade,
  user_id      uuid references auth.users (id) on delete cascade,
  guest_id     uuid,
  player_name  text not null,
  time_ms      integer not null,
  best_lap_ms  integer not null,
  char_id    text not null,
  place        smallint not null,
  created_at   timestamptz not null default now(),
  constraint kart_room_runs_who_chk check (user_id is not null or guest_id is not null),
  constraint kart_room_runs_name_chk check (char_length(player_name) between 1 and 24)
);
create index if not exists kart_room_runs_code_idx on public.kart_room_runs (code, time_ms);
create index if not exists kart_room_runs_who_idx on public.kart_room_runs (code, coalesce(user_id, guest_id), created_at desc);

alter table public.kart_players   enable row level security;
alter table public.kart_runs      enable row level security;
alter table public.kart_best      enable row level security;
alter table public.kart_week_best enable row level security;
alter table public.kart_rooms     enable row level security;
alter table public.kart_room_runs enable row level security;
revoke all on public.kart_players, public.kart_runs, public.kart_best, public.kart_week_best,
  public.kart_rooms, public.kart_room_runs from public, anon, authenticated;

-- Validação comum de um resultado (tempo total, melhor volta, cientista, colocação).
create or replace function public.kart_check_run(p_board text, p_time_ms integer, p_best_lap_ms integer, p_character text, p_place integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  lim record;
begin
  select * into lim from public.kart_board_limits(p_board);
  if not lim.ok then return false; end if;
  return p_time_ms is not null and p_best_lap_ms is not null and p_character is not null and p_place is not null
     and p_character ~ '^[a-z0-9-]{1,24}$'
     and p_place between 1 and 8
     and (p_board not like 'tt-%' or p_place = 1)
     and p_time_ms between lim.laps * lim.min_lap_ms and 3600 * 1000
     and p_best_lap_ms between lim.min_lap_ms and p_time_ms
     -- a melhor volta não pode ser pior que a média das voltas
     and p_best_lap_ms::bigint * lim.laps <= p_time_ms::bigint + 1000;
end;
$$;

-- ---------- apelido ----------
create or replace function public.kart_get_me()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  nick text;
  suggest text;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  insert into public.kart_players (user_id) values (uid) on conflict (user_id) do nothing;
  select nickname into nick from public.kart_players where user_id = uid;
  -- sugere o apelido já usado nos outros jogos do site
  if nick is null then
    select nickname into suggest from public.corrida_players where user_id = uid;
    if suggest is null then
      select nickname into suggest from public.corre_professor_players where user_id = uid;
    end if;
  end if;
  return jsonb_build_object('nickname', nick, 'suggest', suggest);
end;
$$;

create or replace function public.kart_set_nickname(p_nickname text)
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
  select nick_changed_at into last_change from public.kart_players where user_id = uid;
  if last_change > now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  if exists (select 1 from public.kart_players
              where nickname is not null and public.corrida_nick_key(nickname) = public.corrida_nick_key(nick)
                and user_id <> uid) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  insert into public.kart_players (user_id, nickname, nick_changed_at) values (uid, nick, now())
    on conflict (user_id) do update set nickname = excluded.nickname, nick_changed_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'nickname', nick);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'taken');
end;
$$;

-- ---------- corrida valendo ranking ----------
-- Bilhete de uso único pedido na largada: o servidor marca a hora.
create or replace function public.kart_start_run(p_board text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  rid uuid := gen_random_uuid();
  lim record;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into lim from public.kart_board_limits(p_board);
  if not lim.ok then raise exception 'Unknown board' using errcode = '22023'; end if;
  insert into public.kart_players (user_id, run_id, run_board, run_started_at) values (uid, rid, p_board, now())
    on conflict (user_id) do update set run_id = excluded.run_id, run_board = excluded.run_board, run_started_at = excluded.run_started_at;
  return rid;
end;
$$;

create or replace function public.kart_submit_run(
  p_run_id uuid, p_board text, p_time_ms integer, p_best_lap_ms integer, p_character text, p_place integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_week timestamptz := date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_run uuid;
  v_board text;
  v_started timestamptz;
  last_at timestamptz;
  day_count integer;
  has_nick boolean;
  best_ms integer;
  week_ms integer;
  rank_all integer;
  rank_week integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'anonymous');
  end if;
  if p_run_id is null or not public.kart_check_run(p_board, p_time_ms, p_best_lap_ms, p_character, p_place) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kart_submit:' || uid::text, 0));
  select run_id, run_board, run_started_at into v_run, v_board, v_started
    from public.kart_players where user_id = uid for update;
  if v_run is distinct from p_run_id or v_board is distinct from p_board then
    return jsonb_build_object('ok', false, 'error', 'no_run');
  end if;
  update public.kart_players set run_id = null where user_id = uid;
  -- o tempo de corrida não pode ser maior que o tempo real desde o bilhete
  if p_time_ms > extract(epoch from now() - v_started) * 1000 + 3000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select max(created_at), count(*) into last_at, day_count
    from public.kart_runs where user_id = uid and created_at > now() - interval '1 day';
  if last_at is not null and last_at > now() - interval '10 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  if day_count >= 300 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  insert into public.kart_runs (user_id, board, time_ms, best_lap_ms, char_id, place)
    values (uid, p_board, p_time_ms, p_best_lap_ms, p_character, p_place);
  insert into public.kart_best as b (board, user_id, time_ms, best_lap_ms, char_id, achieved_at)
    values (p_board, uid, p_time_ms, p_best_lap_ms, p_character, now())
    on conflict (board, user_id) do update
      set time_ms = excluded.time_ms, best_lap_ms = excluded.best_lap_ms, char_id = excluded.char_id, achieved_at = excluded.achieved_at
      where excluded.time_ms < b.time_ms;
  insert into public.kart_week_best as w (week_start, board, user_id, time_ms, best_lap_ms, char_id, achieved_at)
    values (v_week, p_board, uid, p_time_ms, p_best_lap_ms, p_character, now())
    on conflict (week_start, board, user_id) do update
      set time_ms = excluded.time_ms, best_lap_ms = excluded.best_lap_ms, char_id = excluded.char_id, achieved_at = excluded.achieved_at
      where excluded.time_ms < w.time_ms;
  update public.kart_players set updated_at = now() where user_id = uid
    returning nickname is not null into has_nick;

  select b.time_ms into best_ms from public.kart_best b where b.board = p_board and b.user_id = uid;
  select w.time_ms into week_ms from public.kart_week_best w
    where w.week_start = v_week and w.board = p_board and w.user_id = uid;
  select count(*) + 1 into rank_all from public.kart_best b
    join public.kart_players p on p.user_id = b.user_id and p.nickname is not null
   where b.board = p_board and b.time_ms < best_ms;
  select count(*) + 1 into rank_week from public.kart_week_best w
    join public.kart_players p on p.user_id = w.user_id and p.nickname is not null
   where w.week_start = v_week and w.board = p_board and w.time_ms < week_ms;

  return jsonb_build_object('ok', true, 'best', best_ms, 'week_best', week_ms,
    'rank_all',  case when has_nick then rank_all end,
    'rank_week', case when has_nick then rank_week end);
end;
$$;

create or replace function public.kart_leaderboard(p_board text, p_period text default 'week', p_limit integer default 10)
returns table (rank integer, nickname text, time_ms integer, best_lap_ms integer, char_id text, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_week timestamptz := date_trunc('week', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not (select ok from public.kart_board_limits(p_board)) then return; end if;
  if p_period = 'all' then
    return query
    with ranked as (
      select (rank() over (order by b.time_ms))::integer as rk, p.nickname as nick, b.time_ms as tm, b.best_lap_ms as bl,
             b.char_id as ch, b.user_id as uid_,
             row_number() over (order by b.time_ms, b.achieved_at, b.user_id) as pos
        from public.kart_best b
        join public.kart_players p on p.user_id = b.user_id and p.nickname is not null
       where b.board = p_board
    )
    select k.rk, k.nick, k.tm, k.bl, k.ch, coalesce(k.uid_ = uid, false)
      from ranked k where k.pos <= lim or k.uid_ = uid order by k.pos;
  else
    return query
    with ranked as (
      select (rank() over (order by w.time_ms))::integer as rk, p.nickname as nick, w.time_ms as tm, w.best_lap_ms as bl,
             w.char_id as ch, w.user_id as uid_,
             row_number() over (order by w.time_ms, w.achieved_at, w.user_id) as pos
        from public.kart_week_best w
        join public.kart_players p on p.user_id = w.user_id and p.nickname is not null
       where w.week_start = v_week and w.board = p_board
    )
    select k.rk, k.nick, k.tm, k.bl, k.ch, coalesce(k.uid_ = uid, false)
      from ranked k where k.pos <= lim or k.uid_ = uid order by k.pos;
  end if;
end;
$$;

-- ---------- salas de turma ----------
create or replace function public.kart_room_create(p_name text, p_board text)
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
  if nm is null or not (select ok from public.kart_board_limits(p_board)) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select count(*), max(created_at) into n_active, last_at from public.kart_rooms where owner_id = uid and expires_at > now();
  if last_at > now() - interval '10 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  if n_active >= 30 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  loop
    select string_agg(substr(alpha, 1 + floor(random() * length(alpha))::integer, 1), '') into v_code from generate_series(1, 5);
    exit when not exists (select 1 from public.kart_rooms r where r.code = v_code);
    tries := tries + 1;
    if tries > 20 then raise exception 'Could not allocate a room code'; end if;
  end loop;
  insert into public.kart_rooms (code, owner_id, name, board) values (v_code, uid, nm, p_board);
  return jsonb_build_object('ok', true, 'code', v_code, 'name', nm, 'board', p_board);
end;
$$;

create or replace function public.kart_room_get(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
  parts integer;
begin
  select * into r from public.kart_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select count(distinct coalesce(user_id, guest_id)) into parts from public.kart_room_runs where code = r.code;
  return jsonb_build_object('code', r.code, 'name', r.name, 'board', r.board,
    'owner', coalesce(r.owner_id = uid, false), 'participants', parts,
    'open', r.open and r.expires_at > now(), 'created_at', r.created_at, 'expires_at', r.expires_at);
end;
$$;

create or replace function public.kart_room_submit(
  p_code text, p_name text, p_guest_id uuid, p_time_ms integer, p_best_lap_ms integer, p_character text, p_place integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
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
  select * into r from public.kart_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not r.open or r.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if uid is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then uid := null; end if;
  if uid is not null then
    select nickname into nick from public.kart_players where user_id = uid;
    v_who := uid;
  else
    if p_guest_id is null then return jsonb_build_object('ok', false, 'error', 'anonymous'); end if;
    v_who := p_guest_id; v_guest := p_guest_id;
  end if;
  nm := public.corrida_room_clean_name(coalesce(nick, p_name), 24);
  if nm is null then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  if not public.kart_check_run(r.board, p_time_ms, p_best_lap_ms, p_character, p_place) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kart_room:' || r.code, 0));
  select max(created_at), count(*) into last_at, n_runs
    from public.kart_room_runs where code = r.code and coalesce(user_id, guest_id) = v_who;
  if last_at is not null and last_at > now() - interval '10 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  select count(*) into n_room from public.kart_room_runs where code = r.code;
  if n_runs >= 200 or n_room >= 5000 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  insert into public.kart_room_runs (code, user_id, guest_id, player_name, time_ms, best_lap_ms, char_id, place)
    values (r.code, uid, v_guest, nm, p_time_ms, p_best_lap_ms, p_character, p_place);
  with best as (
    select coalesce(user_id, guest_id) as who, min(time_ms) as tm from public.kart_room_runs where code = r.code group by 1
  )
  select (select tm from best where who = v_who), count(*), (select count(*) + 1 from best b2 where b2.tm < (select tm from best where who = v_who))
    into v_best, v_parts, v_rank
    from best;
  return jsonb_build_object('ok', true, 'rank', v_rank, 'participants', v_parts, 'best', v_best, 'name', nm);
end;
$$;

-- Placar da sala: qualquer um com o código vê (nomes, melhores tempos e cientista).
create or replace function public.kart_room_board(p_code text, p_guest_id uuid default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_out jsonb;
begin
  select * into r from public.kart_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  with best as (
    select distinct on (coalesce(user_id, guest_id)) coalesce(user_id, guest_id) as who, player_name, time_ms, best_lap_ms, char_id, created_at
      from public.kart_room_runs where code = r.code
     order by coalesce(user_id, guest_id), time_ms, created_at
  ), ranked as (
    select (rank() over (order by time_ms))::integer as rk, player_name, time_ms, best_lap_ms, char_id, who,
           row_number() over (order by time_ms, created_at) as pos
      from best
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'name', player_name, 'time_ms', time_ms, 'best_lap_ms', best_lap_ms,
           'character', char_id, 'is_me', who = coalesce(uid, p_guest_id)) order by pos), '[]'::jsonb)
    into v_out
    from ranked where pos <= lim or who = coalesce(uid, p_guest_id);
  return jsonb_build_object('code', r.code, 'name', r.name, 'board', r.board, 'open', r.open and r.expires_at > now(), 'players', v_out);
end;
$$;

-- Relatório do professor (dono da sala): todos os alunos, melhor tempo e número de corridas.
create or replace function public.kart_room_report(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
  v_players jsonb;
  v_runs integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into r from public.kart_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.owner_id <> uid then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  with runs as (
    select coalesce(user_id, guest_id) as who, user_id, player_name, time_ms, best_lap_ms, char_id, place, created_at
      from public.kart_room_runs where code = r.code
  ), best as (
    select distinct on (who) who, user_id, player_name, time_ms, best_lap_ms, char_id, place, created_at
      from runs order by who, time_ms, created_at
  ), cnt as (
    select who, count(*) as n, max(created_at) as last_at from runs group by who
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', b.player_name, 'time_ms', b.time_ms, 'best_lap_ms', b.best_lap_ms, 'character', b.char_id,
           'place', b.place, 'runs', c.n, 'last_at', c.last_at, 'guest', b.user_id is null)
           order by b.time_ms, b.created_at), '[]'::jsonb), sum(c.n)::integer
    into v_players, v_runs
    from best b join cnt c on c.who = b.who;
  return jsonb_build_object('ok', true,
    'room', jsonb_build_object('code', r.code, 'name', r.name, 'board', r.board, 'open', r.open and r.expires_at > now(),
                               'created_at', r.created_at, 'expires_at', r.expires_at, 'runs', coalesce(v_runs, 0)),
    'players', v_players);
end;
$$;

create or replace function public.kart_room_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_out jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', r.code, 'name', r.name, 'board', r.board, 'open', r.open and r.expires_at > now(), 'created_at', r.created_at,
           'participants', (select count(distinct coalesce(x.user_id, x.guest_id)) from public.kart_room_runs x where x.code = r.code),
           'runs', (select count(*) from public.kart_room_runs x where x.code = r.code))
           order by r.created_at desc), '[]'::jsonb)
    into v_out
    from public.kart_rooms r where r.owner_id = uid and r.expires_at > now() - interval '60 days';
  return v_out;
end;
$$;

create or replace function public.kart_room_close(p_code text, p_open boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  update public.kart_rooms set open = coalesce(p_open, false) where code = upper(btrim(coalesce(p_code, ''))) and owner_id = uid;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'open', coalesce(p_open, false));
end;
$$;

-- ---------- permissões ----------
revoke all on function public.kart_board_limits(text) from public, anon, authenticated;
revoke all on function public.kart_check_run(text, integer, integer, text, integer) from public, anon, authenticated;
revoke all on function public.kart_get_me() from public, anon;
revoke all on function public.kart_set_nickname(text) from public, anon;
revoke all on function public.kart_start_run(text) from public, anon;
revoke all on function public.kart_submit_run(uuid, text, integer, integer, text, integer) from public, anon;
revoke all on function public.kart_leaderboard(text, text, integer) from public;
revoke all on function public.kart_room_create(text, text) from public, anon;
revoke all on function public.kart_room_get(text) from public;
revoke all on function public.kart_room_submit(text, text, uuid, integer, integer, text, integer) from public;
revoke all on function public.kart_room_board(text, uuid, integer) from public;
revoke all on function public.kart_room_report(text) from public, anon;
revoke all on function public.kart_room_list() from public, anon;
revoke all on function public.kart_room_close(text, boolean) from public, anon;

grant execute on function public.kart_get_me() to authenticated;
grant execute on function public.kart_set_nickname(text) to authenticated;
grant execute on function public.kart_start_run(text) to authenticated;
grant execute on function public.kart_submit_run(uuid, text, integer, integer, text, integer) to authenticated;
grant execute on function public.kart_leaderboard(text, text, integer) to anon, authenticated;
grant execute on function public.kart_room_create(text, text) to authenticated;
grant execute on function public.kart_room_get(text) to anon, authenticated;
grant execute on function public.kart_room_submit(text, text, uuid, integer, integer, text, integer) to anon, authenticated;
grant execute on function public.kart_room_board(text, uuid, integer) to anon, authenticated;
grant execute on function public.kart_room_report(text) to authenticated;
grant execute on function public.kart_room_list() to authenticated;
grant execute on function public.kart_room_close(text, boolean) to authenticated;
