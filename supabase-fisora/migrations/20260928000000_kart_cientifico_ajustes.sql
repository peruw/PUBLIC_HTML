-- Kart Científico: ajustes da revisão da etapa 2 (depois de 20260927200000_kart_cientifico.sql).
-- Tudo com create or replace / if not exists: pode rodar de novo sem erro. As permissões das funções
-- já existentes continuam as mesmas (create or replace não mexe nelas).
--  1. volta mínima aceita mais próxima do possível no jogo (antes aceitava voltas ~35% mais rápidas que a melhor real);
--  2. cientista só entre os do jogo (antes qualquer texto [a-z0-9-] era gravado e devolvido em público);
--  3. salas: convidado não pode usar o id de uma conta; limite de participantes novos por sala (robô trocando
--     de guest_id); limite da sala com código próprio ('room_limit', não é "por hoje");
--  4. professor pode tirar um aluno do placar da sala (kart_room_remove; o relatório traz o 'id');
--  5. 'Reabrir' uma sala vencida renova o prazo (antes dizia ok e a sala continuava fechada);
--  6. sala vencida há mais de 60 dias some também para quem tem o código (igual à lista do professor);
--  7. índices das chaves estrangeiras user_id (apagar uma conta não varre as tabelas).

-- ---------- 1. limites de cada placar ----------
-- Medido com o autopiloto (habilidade 1,0, contra o relógio, com foguetes): melhor volta 78,1 s (50cc),
-- 60,5 s (100cc) e 51,5 s (150cc). Com turbo ligado na volta INTEIRA (impossível jogando): 64,0 s, 51,5 s
-- e 45,1 s. O mínimo fica ~10% abaixo desse teto físico (nenhum jogo honesto chega nele).
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
  min_lap_ms := case m[2] when '50' then 57000 when '100' then 46000 else 40000 end;
  ok := true;
end;
$$;

-- ---------- 2. validação comum de um resultado ----------
-- Só os cientistas do jogo (corridacientistas/js/config.js, CHARACTERS). Personagem novo = atualizar esta lista.
create or replace function public.kart_check_run(p_board text, p_time_ms integer, p_best_lap_ms integer, p_character text, p_place integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  lim record;
begin
  select * into lim from public.kart_board_limits(p_board);
  if not lim.ok then return false; end if;
  return p_time_ms is not null and p_best_lap_ms is not null and p_character is not null and p_place is not null
     and p_character = any (array['newton', 'curie', 'mendeleev', 'einstein', 'galileu', 'darwin', 'dumont', 'oswaldo',
                                  'samuel', 'lattes', 'franklin', 'johnson', 'enedina'])
     and p_place between 1 and 8
     and (p_board not like 'tt-%' or p_place = 1)
     and p_time_ms between lim.laps * lim.min_lap_ms and 3600 * 1000
     and p_best_lap_ms between lim.min_lap_ms and p_time_ms
     -- a melhor volta não pode ser pior que a média das voltas
     and p_best_lap_ms::bigint * lim.laps <= p_time_ms::bigint + 1000;
end;
$$;

-- ---------- 3. corrida numa sala de turma ----------
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
  n_new integer;
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
    -- conta e convidado dividem a mesma chave (coalesce(user_id, guest_id)): id de conta não vale como convidado
    if exists (select 1 from auth.users u where u.id = p_guest_id) then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
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
    return jsonb_build_object('ok', false, 'error', 'room_limit');
  end if;
  -- participante novo: no máximo 60 a cada 10 minutos por sala (cabe a turma inteira; um robô trocando de guest_id, não)
  if n_runs = 0 then
    select count(*) into n_new from (
      select 1 from public.kart_room_runs where code = r.code
       group by coalesce(user_id, guest_id)
      having min(created_at) > now() - interval '10 minutes') x;
    if n_new >= 60 then return jsonb_build_object('ok', false, 'error', 'room_busy'); end if;
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

-- ---------- 6. sala vencida há mais de 60 dias: some para quem tem o código ----------
create or replace function public.kart_room_get(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
  parts integer;
begin
  select * into r from public.kart_rooms
   where code = upper(btrim(coalesce(p_code, ''))) and expires_at > now() - interval '60 days';
  if not found then return null; end if;
  select count(distinct coalesce(user_id, guest_id)) into parts from public.kart_room_runs where code = r.code;
  return jsonb_build_object('code', r.code, 'name', r.name, 'board', r.board,
    'owner', coalesce(r.owner_id = uid, false), 'participants', parts,
    'open', r.open and r.expires_at > now(), 'created_at', r.created_at, 'expires_at', r.expires_at);
end;
$$;

-- Placar da sala: qualquer um com o código vê (nomes, melhores tempos e cientista), até 60 dias depois de vencer.
create or replace function public.kart_room_board(p_code text, p_guest_id uuid default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_out jsonb;
begin
  select * into r from public.kart_rooms
   where code = upper(btrim(coalesce(p_code, ''))) and expires_at > now() - interval '60 days';
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

-- ---------- 4. relatório do professor (com o id da melhor corrida de cada aluno) e remoção ----------
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
    select id, coalesce(user_id, guest_id) as who, user_id, player_name, time_ms, best_lap_ms, char_id, place, created_at
      from public.kart_room_runs where code = r.code
  ), best as (
    select distinct on (who) id, who, user_id, player_name, time_ms, best_lap_ms, char_id, place, created_at
      from runs order by who, time_ms, created_at
  ), cnt as (
    select who, count(*) as n, max(created_at) as last_at from runs group by who
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'name', b.player_name, 'time_ms', b.time_ms, 'best_lap_ms', b.best_lap_ms, 'character', b.char_id,
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

-- Professor (dono da sala) tira um participante do placar: apaga todas as corridas dele na sala.
-- p_run_id: o 'id' de qualquer corrida dele (o relatório traz o da melhor).
create or replace function public.kart_room_remove(p_code text, p_run_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
  v_who uuid;
  n integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into r from public.kart_rooms where code = upper(btrim(coalesce(p_code, ''))) and owner_id = uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select coalesce(user_id, guest_id) into v_who from public.kart_room_runs where id = p_run_id and code = r.code;
  if v_who is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('kart_room:' || r.code, 0));
  delete from public.kart_room_runs where code = r.code and coalesce(user_id, guest_id) = v_who;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'removed', n);
end;
$$;

-- ---------- 5. fechar / reabrir: reabrir uma sala vencida renova o prazo de 30 dias ----------
-- (conta no limite de 30 salas ativas, como criar uma sala nova)
create or replace function public.kart_room_close(p_code text, p_open boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_open boolean := coalesce(p_open, false);
  r public.kart_rooms%rowtype;
  n_active integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into r from public.kart_rooms where code = upper(btrim(coalesce(p_code, ''))) and owner_id = uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_open and r.expires_at <= now() then
    select count(*) into n_active from public.kart_rooms where owner_id = uid and expires_at > now();
    if n_active >= 30 then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
  end if;
  update public.kart_rooms
     set open = v_open,
         expires_at = case when v_open then greatest(expires_at, now() + interval '30 days') else expires_at end
   where code = r.code
  returning expires_at into r.expires_at;
  return jsonb_build_object('ok', true, 'open', v_open, 'expires_at', r.expires_at);
end;
$$;

-- ---------- 7. índices das chaves estrangeiras (apagar uma conta não varre as tabelas) ----------
create index if not exists kart_best_user_idx on public.kart_best (user_id);
create index if not exists kart_week_best_user_idx on public.kart_week_best (user_id);
create index if not exists kart_room_runs_user_idx on public.kart_room_runs (user_id) where user_id is not null;

-- ---------- permissões ----------
-- (as funções já existentes mantêm as suas; a nova só para quem tem conta)
revoke all on function public.kart_room_remove(text, bigint) from public, anon;
grant execute on function public.kart_room_remove(text, bigint) to authenticated;
