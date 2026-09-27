-- Corrida Quanta: modo prova nas salas, lista da turma com código de 3 dígitos, relatório por aluno
-- e as matérias Biologia e Geografia. Projeto Supabase: fisora. Só toca nas tabelas e funções da Corrida.

-- ===================== Matérias novas =====================
alter table public.corrida_runs drop constraint if exists corrida_runs_mode_check;
alter table public.corrida_runs add constraint corrida_runs_mode_check check (mode in ('mat', 'quim', 'fis', 'bio', 'geo'));
alter table public.corrida_mode_best drop constraint if exists corrida_mode_best_mode_check;
alter table public.corrida_mode_best add constraint corrida_mode_best_mode_check check (mode in ('mat', 'quim', 'fis', 'bio', 'geo'));
alter table public.corrida_week_best drop constraint if exists corrida_week_best_mode_check;
alter table public.corrida_week_best add constraint corrida_week_best_mode_check check (mode in ('mat', 'quim', 'fis', 'bio', 'geo'));
alter table public.corrida_rooms drop constraint if exists corrida_rooms_mode_chk;
alter table public.corrida_rooms add constraint corrida_rooms_mode_chk check (mode in ('mat', 'quim', 'fis', 'bio', 'geo'));

-- velocidades iguais às de js/modes.js
create or replace function public.corrida_mode_speed(p_mode text, out v_start numeric, out v_step numeric, out v_max numeric)
returns record language sql immutable set search_path = '' as $$
  select case p_mode when 'quim' then 12 when 'fis' then 11 when 'bio' then 12 when 'geo' then 13 else 16 end::numeric,
         case p_mode when 'quim' then 0.8 when 'fis' then 0.7 when 'bio' then 0.8 when 'geo' then 0.9 else 1.1 end::numeric,
         case p_mode when 'quim' then 32 when 'fis' then 28 when 'bio' then 32 when 'geo' then 36 else 46 end::numeric;
$$;

create or replace function public.corrida_check_run(
  p_mode text, p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
  p_max_speed numeric, p_duration_ms integer, p_skin text)
returns boolean language sql immutable set search_path = '' as $$
  select p_mode in ('mat', 'quim', 'fis', 'bio', 'geo')
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

-- prova: número fixo de perguntas, sem vidas (várias sequências), p_misses = perguntas erradas
create or replace function public.corrida_check_exam(
  p_mode text, p_exam integer, p_misses integer, p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
  p_max_speed numeric, p_duration_ms integer, p_skin text)
returns boolean language sql immutable set search_path = '' as $$
  select p_mode in ('mat', 'quim', 'fis', 'bio', 'geo')
     and p_exam between 5 and 50
     and p_score is not null and p_hits is not null and p_max_level is not null and p_max_combo is not null
     and p_max_speed is not null and p_duration_ms is not null and p_skin is not null and p_misses is not null
     and not (
       p_hits < 0 or p_hits > p_exam or p_misses <> p_exam - p_hits
       or p_score < 0 or p_score % 10 <> 0
       or p_max_combo < 0 or p_max_combo > p_hits or (p_hits > 0 and p_max_combo < 1)
       or p_score < p_hits::bigint * 10
       or (p_hits = 0 and p_score <> 0)
       or (p_hits > 0 and p_score > least(public.corrida_streak_max(p_hits),
                                          ceil(p_hits::numeric / p_max_combo)::integer * public.corrida_streak_max(p_max_combo)))
       or p_max_level <> 1 + p_hits / 5
       or abs(p_max_speed - least(s.v_max, s.v_start + s.v_step * p_hits) / s.v_start) > 0.011
       or p_duration_ms < public.corrida_min_duration_ms(p_hits + p_misses, p_mode) * 0.95
       or p_duration_ms > 6 * 3600 * 1000
       or p_skin !~ '^[a-z0-9-]{1,24}$')
    from public.corrida_mode_speed(p_mode) s;
$$;

drop function if exists public.corrida_leaderboard(text, integer, text);
create or replace function public.corrida_leaderboard(p_period text default 'week', p_limit integer default 20, p_mode text default 'mat')
returns table (rank integer, nickname text, score integer, skin text, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_mode text := case when p_mode in ('mat', 'quim', 'fis', 'bio', 'geo') then p_mode else 'mat' end;
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
      from ranked k where k.pos <= lim or k.uid_ = uid order by k.pos;
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
      from ranked k where k.pos <= lim or k.uid_ = uid order by k.pos;
  end if;
end;
$$;

-- ===================== Prova e lista da turma =====================
alter table public.corrida_rooms add column if not exists exam_n integer;
alter table public.corrida_rooms drop constraint if exists corrida_rooms_exam_chk;
alter table public.corrida_rooms add constraint corrida_rooms_exam_chk check (exam_n is null or exam_n between 5 and 50);

-- alunos cadastrados pelo professor; cada um recebe um código de 3 dígitos (bloqueia após 8 códigos errados)
create table if not exists public.corrida_room_students (
  id          bigint generated always as identity primary key,
  code        text not null references public.corrida_rooms (code) on delete cascade,
  name        text not null,
  pin         text not null,
  fails       integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint corrida_room_students_name_chk check (char_length(name) between 2 and 24),
  constraint corrida_room_students_pin_chk check (pin ~ '^[0-9]{3}$')
);
create unique index if not exists corrida_room_students_name_idx on public.corrida_room_students (code, lower(name));
alter table public.corrida_room_students enable row level security;
revoke all on public.corrida_room_students from anon, authenticated;

alter table public.corrida_room_runs add column if not exists student_id bigint references public.corrida_room_students (id) on delete set null;
alter table public.corrida_room_runs add column if not exists answered integer not null default 0;
alter table public.corrida_room_runs add column if not exists who text
  generated always as (coalesce('s' || student_id::text, 'u' || user_id::text, 'g' || guest_id::text)) stored;
drop index if exists public.corrida_room_runs_who_idx;
create index if not exists corrida_room_runs_who_idx on public.corrida_room_runs (code, who, created_at desc);

create or replace function public.corrida_room_new_pin()
returns text language sql volatile set search_path = '' as $$
  select lpad(floor(random() * 1000)::integer::text, 3, '0');
$$;

drop function if exists public.corrida_room_create(text, text);
create or replace function public.corrida_room_create(p_name text, p_mode text, p_exam integer default null)
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
  if nm is null or p_mode not in ('mat', 'quim', 'fis', 'bio', 'geo') or (p_exam is not null and p_exam not between 5 and 50) then
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
  insert into public.corrida_rooms (code, owner_id, name, mode, seed, exam_n)
    values (v_code, uid, nm, p_mode, floor(random() * 2147483647)::integer, p_exam);
  return jsonb_build_object('ok', true, 'code', v_code, 'name', nm, 'mode', p_mode, 'exam', p_exam);
end;
$$;

-- dados públicos da sala; com lista da turma, devolve os nomes (sem os códigos)
create or replace function public.corrida_room_get(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.corrida_rooms%rowtype;
  parts integer;
  v_roster jsonb;
begin
  select * into r from public.corrida_rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select count(distinct who) into parts from public.corrida_room_runs where code = r.code;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by lower(s.name)), '[]'::jsonb)
    into v_roster from public.corrida_room_students s where s.code = r.code;
  return jsonb_build_object('code', r.code, 'name', r.name, 'mode', r.mode, 'seed', r.seed, 'exam', r.exam_n,
    'owner', coalesce(r.owner_id = uid, false), 'participants', parts, 'roster', v_roster,
    'open', r.open and r.expires_at > now(), 'created_at', r.created_at, 'expires_at', r.expires_at);
end;
$$;

-- confere o código do aluno (conta tentativas erradas; 8 erros bloqueiam até o professor gerar outro código)
create or replace function public.corrida_room_student_auth(p_code text, p_student_id bigint, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.corrida_room_students%rowtype;
begin
  select * into s from public.corrida_room_students
   where id = p_student_id and code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if s.fails >= 8 then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if coalesce(p_pin, '') <> s.pin then
    update public.corrida_room_students set fails = fails + 1 where id = s.id;
    return jsonb_build_object('ok', false, 'error', case when s.fails + 1 >= 8 then 'locked' else 'wrong_pin' end);
  end if;
  if s.fails > 0 then update public.corrida_room_students set fails = 0 where id = s.id; end if;
  return jsonb_build_object('ok', true, 'id', s.id, 'name', s.name);
end;
$$;

create or replace function public.corrida_room_check_student(p_code text, p_student_id bigint, p_pin text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.corrida_room_student_auth(p_code, p_student_id, p_pin);
$$;

drop function if exists public.corrida_room_submit(text, text, uuid, integer, integer, integer, integer, numeric, integer, text, jsonb);
create or replace function public.corrida_room_submit(
  p_code text, p_name text, p_guest_id uuid, p_student_id bigint, p_pin text,
  p_score integer, p_hits integer, p_max_level integer, p_max_combo integer,
  p_max_speed numeric, p_duration_ms integer, p_skin text, p_misses jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.corrida_rooms%rowtype;
  v_who text;
  v_guest uuid;
  v_student bigint;
  nm text;
  nick text;
  auth_res jsonb;
  has_roster boolean;
  n_miss integer;
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
  if uid is null and p_guest_id is null then return jsonb_build_object('ok', false, 'error', 'anonymous'); end if;
  if uid is null then v_guest := p_guest_id; end if;

  if p_misses is null or jsonb_typeof(p_misses) <> 'array' or jsonb_array_length(p_misses) > 60 or octet_length(p_misses::text) > 24576
     or exists (select 1 from jsonb_array_elements(p_misses) e
                 where jsonb_typeof(e) <> 'object'
                    or char_length(coalesce(e ->> 'k', '')) not between 1 and 80
                    or char_length(coalesce(e ->> 't', '')) > 80 or char_length(coalesce(e ->> 'x', '')) > 80
                    or char_length(coalesce(e ->> 'a', '')) > 40) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  n_miss := jsonb_array_length(p_misses);
  if r.exam_n is not null then
    if not public.corrida_check_exam(r.mode, r.exam_n, n_miss, p_score, p_hits, p_max_level, p_max_combo, p_max_speed, p_duration_ms, p_skin) then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
  elsif n_miss > 3 or not public.corrida_check_run(r.mode, p_score, p_hits, p_max_level, p_max_combo, p_max_speed, p_duration_ms, p_skin) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- com lista da turma, cada aluno joga com o próprio nome (quem criou a sala joga como ele mesmo)
  has_roster := exists (select 1 from public.corrida_room_students where code = r.code);
  if has_roster and uid is distinct from r.owner_id then
    if p_student_id is null then return jsonb_build_object('ok', false, 'error', 'student_required'); end if;
    auth_res := public.corrida_room_student_auth(r.code, p_student_id, p_pin);
    if not (auth_res ->> 'ok')::boolean then return auth_res; end if;
    v_student := p_student_id;
    nm := auth_res ->> 'name';
    v_who := 's' || v_student::text;
  else
    if uid is not null then select nickname into nick from public.corrida_players where user_id = uid; end if;
    nm := public.corrida_room_clean_name(coalesce(nick, p_name), 24);
    if nm is null then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
    v_who := coalesce('u' || uid::text, 'g' || v_guest::text);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('corrida_room:' || r.code, 0));
  select max(created_at), count(*) into last_at, n_runs from public.corrida_room_runs where code = r.code and who = v_who;
  if last_at is not null and last_at > now() - interval '5 seconds' then
    return jsonb_build_object('ok', false, 'error', 'too_fast');
  end if;
  select count(*) into n_room from public.corrida_room_runs where code = r.code;
  if n_runs >= 200 or n_room >= 5000 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  insert into public.corrida_room_runs (code, user_id, guest_id, student_id, player_name, score, hits, answered, max_level, max_combo, duration_ms, misses)
    values (r.code, uid, v_guest, v_student, nm, p_score, p_hits, p_hits + n_miss, p_max_level, p_max_combo, p_duration_ms,
            (select coalesce(jsonb_agg(jsonb_build_object('k', e ->> 'k', 't', coalesce(e ->> 't', ''), 'x', coalesce(e ->> 'x', ''), 'a', coalesce(e ->> 'a', ''))), '[]'::jsonb)
               from jsonb_array_elements(p_misses) e));

  with best as (select who as w, max(score) as sc from public.corrida_room_runs where code = r.code group by 1)
  select (select sc from best where w = v_who), count(*), (select count(*) + 1 from best b2 where b2.sc > (select sc from best where w = v_who))
    into v_best, v_parts, v_rank from best;
  return jsonb_build_object('ok', true, 'rank', v_rank, 'participants', v_parts, 'best', v_best, 'name', nm);
end;
$$;

-- relatório (só quem criou): melhor e primeira tentativa de cada aluno, erros de cada um, perguntas mais erradas
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
    select x.who, x.user_id, x.student_id, coalesce(st.name, x.player_name) as nm, x.score, x.hits, x.answered,
           x.max_combo, x.max_level, x.created_at, x.misses
      from public.corrida_room_runs x left join public.corrida_room_students st on st.id = x.student_id
     where x.code = r.code
  ), best as (
    select distinct on (who) who, user_id, student_id, nm, score, hits, answered, max_combo, max_level, created_at
      from runs order by who, score desc, created_at asc
  ), first as (
    select distinct on (who) who, score, hits, answered, created_at from runs order by who, created_at asc
  ), cnt as (
    select who, count(*) as n, max(created_at) as last_at from runs group by who
  ), miss as (
    select who, jsonb_agg(jsonb_build_object('k', k, 't', t, 'x', x, 'a', a, 'n', n) order by n desc, k) as list
      from (select ru.who, e ->> 'k' as k, min(e ->> 't') as t, min(e ->> 'x') as x, min(e ->> 'a') as a, count(*)::integer as n
              from runs ru, jsonb_array_elements(ru.misses) e group by ru.who, e ->> 'k') m
     group by who
  ), played as (
    select b.who, b.nm, b.student_id, b.user_id, b.score, b.hits, b.answered, b.max_combo, b.max_level, b.created_at,
           f.score as f_score, f.hits as f_hits, f.answered as f_answered, c.n, c.last_at, coalesce(m.list, '[]'::jsonb) as ml
      from best b join first f on f.who = b.who join cnt c on c.who = b.who left join miss m on m.who = b.who
  )
  select coalesce(jsonb_agg(p order by p_score desc nulls last, p_name), '[]'::jsonb), coalesce(sum((p ->> 'runs')::integer), 0)::integer
    into v_players, v_runs
    from (
      select jsonb_build_object('name', pl.nm, 'score', pl.score, 'hits', pl.hits, 'answered', pl.answered,
               'combo', pl.max_combo, 'level', pl.max_level, 'runs', pl.n, 'last_at', pl.last_at,
               'guest', pl.user_id is null, 'student', pl.student_id is not null,
               'first', jsonb_build_object('score', pl.f_score, 'hits', pl.f_hits, 'answered', pl.f_answered),
               'misses', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(pl.ml) e limit 20) q)) as p,
             pl.score as p_score, pl.nm as p_name
        from played pl
      union all
      select jsonb_build_object('name', s.name, 'score', null, 'hits', 0, 'answered', 0, 'runs', 0, 'student', true, 'guest', true,
               'first', null, 'misses', '[]'::jsonb), null, s.name
        from public.corrida_room_students s
       where s.code = r.code and not exists (select 1 from public.corrida_room_runs x where x.code = r.code and x.student_id = s.id)
    ) t;

  with m as (
    select x.who, e ->> 'k' as k, e ->> 't' as t, e ->> 'x' as xx, e ->> 'a' as a
      from public.corrida_room_runs x, jsonb_array_elements(x.misses) e where x.code = r.code
  ), agg as (
    select k, min(t) as t, min(xx) as x, min(a) as a, count(distinct who)::integer as students, count(*)::integer as total
      from m group by k order by students desc, total desc, k limit 15
  )
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 't', t, 'x', x, 'a', a, 'students', students, 'total', total)
           order by students desc, total desc, k), '[]'::jsonb)
    into v_misses from agg;

  return jsonb_build_object('ok', true,
    'room', jsonb_build_object('code', r.code, 'name', r.name, 'mode', r.mode, 'exam', r.exam_n, 'open', r.open and r.expires_at > now(),
                               'created_at', r.created_at, 'expires_at', r.expires_at, 'runs', v_runs),
    'players', v_players, 'misses', v_misses);
end;
$$;

create or replace function public.corrida_room_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_out jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', r.code, 'name', r.name, 'mode', r.mode, 'exam', r.exam_n, 'open', r.open and r.expires_at > now(), 'created_at', r.created_at,
           'participants', (select count(distinct x.who) from public.corrida_room_runs x where x.code = r.code),
           'runs', (select count(*) from public.corrida_room_runs x where x.code = r.code))
           order by r.created_at desc), '[]'::jsonb)
    into v_out
    from public.corrida_rooms r where r.owner_id = uid and r.expires_at > now() - interval '60 days';
  return v_out;
end;
$$;

-- ---------- lista da turma (só quem criou a sala) ----------
create or replace function public.corrida_room_roster(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.corrida_rooms where code = v_code and owner_id = uid) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'students', (
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'pin', s.pin, 'locked', s.fails >= 8) order by lower(s.name)), '[]'::jsonb)
      from public.corrida_room_students s where s.code = v_code));
end;
$$;

-- p_names: um nome por linha
create or replace function public.corrida_room_roster_add(p_code text, p_names text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  ln text;
  nm text;
  n_added integer := 0;
  bad text[] := '{}';
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.corrida_rooms where code = v_code and owner_id = uid) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if char_length(coalesce(p_names, '')) > 6000 then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  foreach ln in array regexp_split_to_array(coalesce(p_names, ''), '\r?\n') loop
    continue when btrim(ln) = '';
    nm := public.corrida_room_clean_name(ln, 24);
    if nm is null then bad := bad || left(btrim(ln), 30); continue; end if;
    if (select count(*) from public.corrida_room_students where code = v_code) >= 80 then
      return jsonb_build_object('ok', false, 'error', 'limit', 'added', n_added);
    end if;
    insert into public.corrida_room_students (code, name, pin) values (v_code, nm, public.corrida_room_new_pin())
      on conflict (code, lower(name)) do nothing;
    if found then n_added := n_added + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'added', n_added, 'rejected', to_jsonb(bad));
end;
$$;

create or replace function public.corrida_room_roster_remove(p_code text, p_student_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  delete from public.corrida_room_students s using public.corrida_rooms r
   where s.id = p_student_id and s.code = r.code and r.code = upper(btrim(coalesce(p_code, ''))) and r.owner_id = uid;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

-- novo código para o aluno (e desbloqueia)
create or replace function public.corrida_room_roster_reset(p_code text, p_student_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_pin text := public.corrida_room_new_pin();
  n integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  update public.corrida_room_students s set pin = v_pin, fails = 0
    from public.corrida_rooms r
   where s.id = p_student_id and s.code = r.code and r.code = upper(btrim(coalesce(p_code, ''))) and r.owner_id = uid;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'pin', v_pin);
end;
$$;

-- ===================== Permissões =====================
revoke all on function public.corrida_check_exam(text, integer, integer, integer, integer, integer, integer, numeric, integer, text) from public, anon, authenticated;
revoke all on function public.corrida_room_new_pin() from public, anon, authenticated;
revoke all on function public.corrida_room_student_auth(text, bigint, text) from public, anon, authenticated;
revoke all on function public.corrida_leaderboard(text, integer, text) from public;
revoke all on function public.corrida_room_create(text, text, integer) from public, anon;
revoke all on function public.corrida_room_check_student(text, bigint, text) from public;
revoke all on function public.corrida_room_submit(text, text, uuid, bigint, text, integer, integer, integer, integer, numeric, integer, text, jsonb) from public;
revoke all on function public.corrida_room_roster(text) from public, anon;
revoke all on function public.corrida_room_roster_add(text, text) from public, anon;
revoke all on function public.corrida_room_roster_remove(text, bigint) from public, anon;
revoke all on function public.corrida_room_roster_reset(text, bigint) from public, anon;

grant execute on function public.corrida_leaderboard(text, integer, text) to anon, authenticated;
grant execute on function public.corrida_room_create(text, text, integer) to authenticated;
grant execute on function public.corrida_room_check_student(text, bigint, text) to anon, authenticated;
grant execute on function public.corrida_room_submit(text, text, uuid, bigint, text, integer, integer, integer, integer, numeric, integer, text, jsonb) to anon, authenticated;
grant execute on function public.corrida_room_roster(text) to authenticated;
grant execute on function public.corrida_room_roster_add(text, text) to authenticated;
grant execute on function public.corrida_room_roster_remove(text, bigint) to authenticated;
grant execute on function public.corrida_room_roster_reset(text, bigint) to authenticated;
