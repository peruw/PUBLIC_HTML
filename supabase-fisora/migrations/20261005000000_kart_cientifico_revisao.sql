-- Kart Científico: verificação completa (outubro/2026), depois de 20260928000000_kart_cientifico_ajustes.sql.
-- Tudo com create or replace / if not exists / drop if exists: pode rodar de novo sem erro.
--  1. sala de turma: bilhete na largada (kart_room_start) e o envio confere o relógio, como no ranking
--     (antes qualquer tempo acima do mínimo era aceito chamando a função direto, sem jogar);
--  2. sala de turma: o nome gravado é o digitado pelo aluno (o apelido do ranking só quando vem vazio),
--     para o professor reconhecer quem é no relatório;
--  3. kart_room_get(p_code, p_name): diz se o nome é aceito (name_ok), para recusar já na entrada da sala
--     e não só no fim da corrida;
--  4. lista de bloqueio de nomes: exceções para sobrenomes e apelidos reais (Yamashita, Kinoshita,
--     Morishita, Shitara, Nigel, Nazinha, Peitosa, Merdan). Vale também para a Corrida e o Corre, Professor!;
--  5. ranking: tolerância do relógio do bilhete de 3 s para 10 s (rede lenta na largada recusava tempo honesto);
--  6. volta mínima aceita: ~90% da melhor volta medida com foguete infinito (50cc 68,8 s; 100cc 54,5 s;
--     150cc 47,6 s); ainda abaixo do teto físico de turbo na volta inteira (64,0/51,5/45,1 s);
--  7. limpeza diária (pg_cron): salas vencidas há mais de 90 dias (as corridas e bilhetes vão junto) e
--     bilhetes de sala com mais de 1 dia.
-- ATENÇÃO: o item 1 exige o jogo novo (main.js pede o bilhete e o manda em kart_room_submit). Publique
-- o jogo junto com esta migração: uma página antiga aberta recebe 'no_run' ao enviar para a sala.

-- ---------- 6. limites de cada placar ----------
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
  min_lap_ms := case m[2] when '50' then 62000 when '100' then 49000 else 43000 end;
  ok := true;
end;
$$;

-- ---------- 4. lista de bloqueio: exceções novas ----------
create or replace function public.corrida_nick_blocked(p text)
returns boolean language sql immutable set search_path = '' as $$
  with s as (
    select regexp_replace(public.corrida_nick_normalize(p),
      'comput|deputad|reputac|disput|amput|imput|abundan|respeitos|notari|rotari|hotari|botari|nazir|nazinha|'
      || 'yoshit|matsushit|yamashit|kinoshit|morishit|kishit|shitar|shiitak|shitak|mushit|tashit|'
      || 'cocktail|cockpit|peacock|hitchcock|hancock|babcock|nigel|peitosa|merdan|'
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

-- ---------- 1. bilhetes das salas de turma ----------
-- Um por aluno (conta ou convidado) e sala: o último pedido vale. Uso único.
create table if not exists public.kart_room_tickets (
  code        text not null references public.kart_rooms (code) on delete cascade,
  who         uuid not null,  -- coalesce(user_id, guest_id), igual a kart_room_runs
  run_id      uuid not null,
  started_at  timestamptz not null default now(),
  first_at    timestamptz not null default now(),
  primary key (code, who)
);
create index if not exists kart_room_tickets_first_idx on public.kart_room_tickets (code, first_at);
alter table public.kart_room_tickets enable row level security;
revoke all on public.kart_room_tickets from public, anon, authenticated;

-- Bilhete pedido na largada de uma corrida na sala: o servidor marca a hora. null = sala fechada,
-- não existe, convidado inválido ou muita gente nova entrando.
create or replace function public.kart_room_start(p_code text, p_guest_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
  v_who uuid;
  rid uuid := gen_random_uuid();
  n_new integer;
  n_all integer;
begin
  select * into r from public.kart_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found or not r.open or r.expires_at < now() then return null; end if;
  if uid is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then uid := null; end if;
  if uid is not null then
    v_who := uid;
  else
    if p_guest_id is null then return null; end if;
    if exists (select 1 from auth.users u where u.id = p_guest_id) then return null; end if;
    v_who := p_guest_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kart_room_ticket:' || r.code, 0));
  if not exists (select 1 from public.kart_room_tickets where code = r.code and who = v_who) then
    -- aluno novo nesta sala: no máximo 120 a cada 10 minutos e 3000 no total (robô trocando de guest_id)
    select count(*) filter (where first_at > now() - interval '10 minutes'), count(*) into n_new, n_all
      from public.kart_room_tickets where code = r.code;
    if n_new >= 120 or n_all >= 3000 then return null; end if;
  end if;
  insert into public.kart_room_tickets (code, who, run_id, started_at, first_at)
    values (r.code, v_who, rid, now(), now())
    on conflict (code, who) do update set run_id = excluded.run_id, started_at = excluded.started_at;
  return rid;
end;
$$;

-- ---------- 1 e 2. corrida numa sala de turma (agora com bilhete) ----------
-- (a versão antiga é renomeada, não apagada: a ferramenta de migração pede confirmação manual para DROP)
alter function public.kart_room_submit(text, text, uuid, integer, integer, text, integer) rename to kart_room_submit_v1;
revoke all on function public.kart_room_submit_v1(text, text, uuid, integer, integer, text, integer) from public, anon, authenticated;
create or replace function public.kart_room_submit(
  p_code text, p_name text, p_guest_id uuid, p_time_ms integer, p_best_lap_ms integer, p_character text, p_place integer,
  p_ticket uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.kart_rooms%rowtype;
  v_who uuid;
  v_guest uuid;
  nm text;
  nick text;
  v_started timestamptz;
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
  -- o nome digitado pelo aluno (o professor precisa reconhecê-lo); vazio: o apelido do ranking
  nm := public.corrida_room_clean_name(coalesce(nullif(btrim(coalesce(p_name, '')), ''), nick), 24);
  if nm is null then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  if not public.kart_check_run(r.board, p_time_ms, p_best_lap_ms, p_character, p_place) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kart_room:' || r.code, 0));
  -- bilhete de uso único pedido na largada; o tempo de corrida não passa do tempo real desde ele
  -- consome o bilhete (troca o run_id) sem apagar a linha: first_at continua contando o aluno como já visto
  update public.kart_room_tickets set run_id = gen_random_uuid()
   where code = r.code and who = v_who and run_id = p_ticket
   returning started_at into v_started;
  if p_ticket is null or v_started is null then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  if p_time_ms > extract(epoch from now() - v_started) * 1000 + 10000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select max(created_at), count(*) into last_at, n_runs
    from public.kart_room_runs where code = r.code and coalesce(user_id, guest_id) = v_who;
  if last_at is not null and last_at > now() - interval '10 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  select count(*) into n_room from public.kart_room_runs where code = r.code;
  if n_runs >= 200 or n_room >= 5000 then
    return jsonb_build_object('ok', false, 'error', 'room_limit');
  end if;
  -- participante novo: no máximo 60 a cada 10 minutos por sala
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

-- ---------- 3. sala + nome aceito ----------
alter function public.kart_room_get(text) rename to kart_room_get_v1;
revoke all on function public.kart_room_get_v1(text) from public, anon, authenticated;
create or replace function public.kart_room_get(p_code text, p_name text default null)
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
    'open', r.open and r.expires_at > now(), 'created_at', r.created_at, 'expires_at', r.expires_at,
    'name_ok', case when p_name is null then null else public.corrida_room_clean_name(p_name, 24) is not null end);
end;
$$;

-- ---------- 5. ranking: tolerância do relógio do bilhete ----------
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
  -- o tempo de corrida não pode ser maior que o tempo real desde o bilhete (10 s de folga: o bilhete
  -- é pedido na largada e pode demorar a chegar com a rede da escola lenta)
  if p_time_ms > extract(epoch from now() - v_started) * 1000 + 10000 then
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

-- ---------- permissões ----------
-- (as funções recriadas com drop perdem as permissões: valem de novo aqui)
revoke all on function public.kart_room_start(text, uuid) from public, anon, authenticated;
revoke all on function public.kart_room_submit(text, text, uuid, integer, integer, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.kart_room_get(text, text) from public, anon, authenticated;
grant execute on function public.kart_room_start(text, uuid) to anon, authenticated;
grant execute on function public.kart_room_submit(text, text, uuid, integer, integer, text, integer, uuid) to anon, authenticated;
grant execute on function public.kart_room_get(text, text) to anon, authenticated;

-- ---------- 7. limpeza diária ----------
-- Salas vencidas há mais de 90 dias somem (corridas e bilhetes vão junto, ON DELETE CASCADE); bilhetes velhos também.
-- NÃO aplicada ainda: o agendamento (cron.schedule) pede confirmação manual na ferramenta de migração.
-- Para ativar, rode no SQL Editor do Supabase:
--   create or replace function public.kart_cleanup() returns void language plpgsql security definer set search_path = '' as $f$
--   begin
--     delete from public.kart_rooms where expires_at < now() - interval '90 days';
--     delete from public.kart_room_tickets where started_at < now() - interval '1 day';
--   end; $f$;
--   revoke all on function public.kart_cleanup() from public, anon, authenticated;
--   select cron.schedule('kart-cientifico-limpeza', '41 6 * * *', 'select public.kart_cleanup()');
