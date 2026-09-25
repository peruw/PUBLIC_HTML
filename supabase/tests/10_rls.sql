-- =====================================================================
-- Asserções de RLS, grants e regras de negócio do portal /professores/.
-- Roda depois de 00_shim.sql + migrações + seed.sql (scripts/test-db.sh).
-- Cada bloco DO levanta "FALHOU: …" se uma regra for violada; o psql
-- (ON_ERROR_STOP) para no primeiro erro. Os blocos rodam em sequência e
-- dependem do estado deixado pelos anteriores.
-- =====================================================================
set client_min_messages = notice;

-- ---------- Helpers ----------
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
create sequence tests.passed;
grant usage on sequence tests.passed to anon, authenticated, service_role;

-- Nomes → UUIDs (seed: ...a000...; criados aqui: ...c000...)
create function tests.uid(p text) returns uuid language sql immutable as $$
  select (case p
    when 'ana'      then '00000000-0000-4000-a000-000000000001'
    when 'bruno'    then '00000000-0000-4000-a000-000000000002'
    when 'carla'    then '00000000-0000-4000-a000-000000000003'
    when 'eduarda'  then '00000000-0000-4000-a000-000000000005'
    when 'gabriela' then '00000000-0000-4000-a000-000000000007'
    when 'maria'    then '00000000-0000-4000-a000-000000000011'
    when 'joao'     then '00000000-0000-4000-a000-000000000012'
    when 'paula'    then '00000000-0000-4000-c000-000000000001'
    when 'rafael'   then '00000000-0000-4000-c000-000000000002'
    when 'tiago'    then '00000000-0000-4000-c000-000000000003'
    when 'bia'      then '00000000-0000-4000-c000-000000000004'
    when 'admin'    then '00000000-0000-4000-c000-000000000005'
    when 'leo'      then '00000000-0000-4000-c000-000000000006'
    when 'teresa'   then '00000000-0000-4000-c000-000000000011'
    when 'otavio'   then '00000000-0000-4000-c000-000000000012'
    when 'silvia'   then '00000000-0000-4000-c000-000000000013'
    when 'vitor'    then '00000000-0000-4000-c000-000000000021'
    when 'xavier'   then '00000000-0000-4000-c000-000000000022'
    when 'extra1'   then '00000000-0000-4000-d000-000000000001'
    when 'extra2'   then '00000000-0000-4000-d000-000000000002'
    when 'extra3'   then '00000000-0000-4000-d000-000000000003'
    when 'antiga'   then '00000000-0000-4000-e000-000000000001'
  end)::uuid
$$;

-- Troca de papel como o PostgREST faz (vale até o fim da transação)
create function tests.login(p_name text) returns void language plpgsql as $$
begin
  if tests.uid(p_name) is null then
    raise exception 'tests.login: usuário desconhecido %', p_name;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', tests.uid(p_name)::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

create function tests.anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
end $$;

create function tests.service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
end $$;

-- Volta ao superusuário (setup/inspeção sem RLS)
create function tests.su() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;

create function tests.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'FALHOU: %', p_label;
  end if;
  perform nextval('tests.passed');
  raise notice 'ok - %', p_label;
end $$;

create function tests.eq(p_actual text, p_expected text, p_label text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALHOU: % (esperado %, veio %)', p_label, coalesce(p_expected, 'NULL'), coalesce(p_actual, 'NULL');
  end if;
  perform nextval('tests.passed');
  raise notice 'ok - %', p_label;
end $$;

-- Executa SQL que DEVE falhar com o SQLSTATE indicado (e mensagem, se p_like)
create function tests.throws(p_sql text, p_state text, p_label text, p_like text default null)
returns void language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if p_state is not null and v_state <> p_state then
      raise exception 'FALHOU: % (esperado erro %, veio %: %)', p_label, p_state, v_state, v_msg;
    end if;
    if p_like is not null and v_msg not ilike p_like then
      raise exception 'FALHOU: % (mensagem "%" não casa com "%")', p_label, v_msg, p_like;
    end if;
    perform nextval('tests.passed');
    raise notice 'ok - % [%: %]', p_label, v_state, v_msg;
    return;
  end;
  raise exception 'FALHOU: % (deveria falhar com %)', p_label, p_state;
end $$;

-- Linhas afetadas por um UPDATE/DELETE (RLS filtra em silêncio → 0)
create function tests.affected(p_sql text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Concorrência: dblink abre conexões de verdade (PostgREST atende requisições em paralelo)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'dblink') then
    create extension if not exists dblink schema tests;
  end if;
end $$;

-- Roda cada comando numa conexão própria, como p_user, todas com a transação aberta ao
-- mesmo tempo; faz commit na ordem em que terminam. Devolve quantos deram certo.
create function tests.race(p_user text, p_sqls text[]) returns int language plpgsql as $$
declare
  n int := coalesce(array_length(p_sqls, 1), 0);
  cs text := format('host=%s port=%s dbname=%s user=%s',
                    split_part(current_setting('unix_socket_directories'), ',', 1),
                    current_setting('port'), current_database(), session_user);
  v_msgs text := current_setting('client_min_messages');
  done boolean[] := array_fill(false, array[n]);
  v_ok int := 0;
  pending int;
  c text;
begin
  -- os erros esperados (limite) viram NOTICE do dblink: silencia só aqui
  perform set_config('client_min_messages', 'warning', false);
  for i in 1..n loop
    c := 'tests_race_' || i;
    perform tests.dblink_connect(c, cs);
    perform tests.dblink_exec(c, 'begin');
    perform tests.dblink_exec(c, 'set local role authenticated');
    perform tests.dblink_exec(c, format('set local request.jwt.claim.sub = %L', tests.uid(p_user)));
    perform tests.dblink_send_query(c, p_sqls[i]);
  end loop;
  for tick in 1..3000 loop -- até ~30 s
    pending := 0;
    for i in 1..n loop
      continue when done[i];
      c := 'tests_race_' || i;
      if tests.dblink_is_busy(c) = 1 then
        pending := pending + 1;
        continue;
      end if;
      perform * from tests.dblink_get_result(c, false) as t(r text);
      if tests.dblink_error_message(c) = 'OK' then
        v_ok := v_ok + 1;
      end if;
      perform * from tests.dblink_get_result(c, false) as t(r text); -- esvazia
      perform tests.dblink_exec(c, 'commit');
      perform tests.dblink_disconnect(c);
      done[i] := true;
    end loop;
    exit when pending = 0;
    perform pg_sleep(0.01);
  end loop;
  perform set_config('client_min_messages', v_msgs, false);
  if pending > 0 then
    raise exception 'tests.race: conexões travadas (deadlock?)';
  end if;
  return v_ok;
end $$;

-- Usuários de teste (como superusuário; o trigger de signup cria os perfis)
create function tests.new_user(p_id uuid, p_name text, p_role text default 'student') returns uuid
language plpgsql as $$
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_id::text || '@teste.local',
          jsonb_build_object('full_name', p_name, 'role', p_role, 'accepted_terms', true));
  return p_id;
end $$;

create function tests.new_tutor(p_id uuid, p_name text, p_publish boolean default true) returns uuid
language plpgsql as $$
begin
  perform tests.new_user(p_id, p_name, 'tutor');
  insert into public.tutor_subjects (tutor_id, subject_id)
    select p_id, s.id from public.subjects s where s.slug = 'xadrez';
  update public.tutor_profiles
     set headline = 'Aulas de xadrez para todas as idades', hourly_rate_cents = 4000,
         mode_online = true, published = p_publish
   where user_id = p_id;
  return p_id;
end $$;

-- ---------- Setup ----------
do $$
begin
  perform tests.new_user(tests.uid('paula'), 'Paula Oliveira');
  perform tests.new_user(tests.uid('rafael'), 'Rafael Gomes');
  perform tests.new_user(tests.uid('tiago'), 'Tiago Terceiro');
  perform tests.new_user(tests.uid('bia'), 'Beatriz Banida');
  perform tests.new_user(tests.uid('admin'), 'Admin Geral');
  perform tests.new_user(tests.uid('leo'), 'Leo Futuro');
  update public.profiles set is_admin = true where id = tests.uid('admin');
  perform tests.new_tutor(tests.uid('teresa'), 'Teresa Tutora', true);
  perform tests.new_tutor(tests.uid('otavio'), 'Otávio Oculto', false);
  perform tests.new_tutor(tests.uid('silvia'), 'Sílvia Suspensa', true);
  update public.tutor_profiles set suspended = true where user_id = tests.uid('silvia');
end $$;

-- =====================================================================
-- 1. Grants (matriz por papel/tabela/coluna/função)
-- =====================================================================
do $$
declare
  r record;
begin
  for r in select * from (values
    -- leitura pública
    ('anon', 'public.profiles', 'SELECT', true), ('anon', 'public.plans', 'SELECT', true),
    ('anon', 'public.subjects', 'SELECT', true), ('anon', 'public.tutor_profiles', 'SELECT', true),
    ('anon', 'public.tutor_subjects', 'SELECT', true), ('anon', 'public.reviews', 'SELECT', true),
    ('anon', 'public.questions', 'SELECT', true), ('anon', 'public.answers', 'SELECT', true),
    -- privado: anon não lê
    ('anon', 'public.conversations', 'SELECT', false), ('anon', 'public.messages', 'SELECT', false),
    ('anon', 'public.payments', 'SELECT', false), ('anon', 'public.reports', 'SELECT', false),
    -- anon não escreve em nada
    ('anon', 'public.profiles', 'UPDATE', false), ('anon', 'public.tutor_profiles', 'UPDATE', false),
    ('anon', 'public.tutor_subjects', 'INSERT', false), ('anon', 'public.tutor_subjects', 'DELETE', false),
    ('anon', 'public.reviews', 'INSERT', false), ('anon', 'public.questions', 'INSERT', false),
    ('anon', 'public.answers', 'INSERT', false), ('anon', 'public.messages', 'INSERT', false),
    ('anon', 'public.reports', 'INSERT', false), ('anon', 'public.payments', 'INSERT', false),
    ('anon', 'public.plans', 'UPDATE', false), ('anon', 'public.subjects', 'INSERT', false),
    -- registro do rate limit: só funções definer
    ('anon', 'public.rate_events', 'SELECT', false), ('authenticated', 'public.rate_events', 'SELECT', false),
    ('authenticated', 'public.rate_events', 'INSERT', false), ('authenticated', 'public.rate_events', 'UPDATE', false),
    ('authenticated', 'public.rate_events', 'DELETE', false),
    -- authenticated: leitura
    ('authenticated', 'public.conversations', 'SELECT', true), ('authenticated', 'public.messages', 'SELECT', true),
    ('authenticated', 'public.payments', 'SELECT', true), ('authenticated', 'public.reports', 'SELECT', true),
    -- authenticated: sem escrita de tabela inteira
    ('authenticated', 'public.profiles', 'INSERT', false), ('authenticated', 'public.profiles', 'DELETE', false),
    ('authenticated', 'public.plans', 'INSERT', false), ('authenticated', 'public.plans', 'UPDATE', false),
    ('authenticated', 'public.plans', 'DELETE', false), ('authenticated', 'public.subjects', 'INSERT', false),
    ('authenticated', 'public.subjects', 'UPDATE', false), ('authenticated', 'public.subjects', 'DELETE', false),
    ('authenticated', 'public.tutor_profiles', 'INSERT', false), ('authenticated', 'public.tutor_profiles', 'DELETE', false),
    ('authenticated', 'public.tutor_subjects', 'DELETE', true),
    ('authenticated', 'public.conversations', 'INSERT', false), ('authenticated', 'public.conversations', 'UPDATE', false),
    ('authenticated', 'public.conversations', 'DELETE', false),
    ('authenticated', 'public.messages', 'UPDATE', false), ('authenticated', 'public.messages', 'DELETE', false),
    ('authenticated', 'public.reviews', 'DELETE', true), ('authenticated', 'public.questions', 'DELETE', true),
    ('authenticated', 'public.answers', 'DELETE', true),
    ('authenticated', 'public.payments', 'INSERT', false), ('authenticated', 'public.payments', 'UPDATE', false),
    ('authenticated', 'public.payments', 'DELETE', false),
    ('authenticated', 'public.reports', 'UPDATE', false), ('authenticated', 'public.reports', 'DELETE', false),
    ('authenticated', 'public.tutor_profiles', 'TRUNCATE', false), ('authenticated', 'public.messages', 'TRUNCATE', false),
    -- service_role (Edge Functions) mantém tudo
    ('service_role', 'public.payments', 'INSERT', true), ('service_role', 'public.payments', 'UPDATE', true)
  ) v(rol, tbl, priv, expected)
  loop
    perform tests.ok(has_table_privilege(r.rol, r.tbl, r.priv) = r.expected,
                     format('grant tabela: %s %s %s = %s', r.rol, r.priv, r.tbl, r.expected));
  end loop;

  for r in select * from (values
    ('public.profiles', 'full_name', 'UPDATE', true), ('public.profiles', 'avatar_path', 'UPDATE', true),
    ('public.profiles', 'role', 'UPDATE', false), ('public.profiles', 'is_admin', 'UPDATE', false),
    ('public.profiles', 'banned_at', 'UPDATE', false), ('public.profiles', 'terms_accepted_at', 'UPDATE', false),
    ('public.profiles', 'id', 'UPDATE', false),
    ('public.tutor_profiles', 'slug', 'UPDATE', true), ('public.tutor_profiles', 'headline', 'UPDATE', true),
    ('public.tutor_profiles', 'bio', 'UPDATE', true), ('public.tutor_profiles', 'hourly_rate_cents', 'UPDATE', true),
    ('public.tutor_profiles', 'mode_online', 'UPDATE', true), ('public.tutor_profiles', 'mode_presencial', 'UPDATE', true),
    ('public.tutor_profiles', 'uf', 'UPDATE', true), ('public.tutor_profiles', 'city_ibge', 'UPDATE', true),
    ('public.tutor_profiles', 'city_name', 'UPDATE', true), ('public.tutor_profiles', 'published', 'UPDATE', true),
    ('public.tutor_profiles', 'plan', 'UPDATE', false), ('public.tutor_profiles', 'plan_expires_at', 'UPDATE', false),
    ('public.tutor_profiles', 'rating_avg', 'UPDATE', false), ('public.tutor_profiles', 'rating_count', 'UPDATE', false),
    ('public.tutor_profiles', 'suspended', 'UPDATE', false), ('public.tutor_profiles', 'search_tsv', 'UPDATE', false),
    ('public.tutor_profiles', 'user_id', 'UPDATE', false), ('public.tutor_profiles', 'last_active_at', 'UPDATE', false),
    ('public.tutor_subjects', 'tutor_id', 'INSERT', true), ('public.tutor_subjects', 'subject_id', 'INSERT', true),
    ('public.tutor_subjects', 'levels', 'INSERT', true), ('public.tutor_subjects', 'levels', 'UPDATE', true),
    ('public.tutor_subjects', 'subject_id', 'UPDATE', false), ('public.tutor_subjects', 'tutor_id', 'UPDATE', false),
    ('public.messages', 'conversation_id', 'INSERT', true), ('public.messages', 'body', 'INSERT', true),
    ('public.messages', 'sender_id', 'INSERT', false), ('public.messages', 'created_at', 'INSERT', false),
    ('public.reviews', 'tutor_id', 'INSERT', true), ('public.reviews', 'rating', 'INSERT', true),
    ('public.reviews', 'comment', 'INSERT', true), ('public.reviews', 'student_id', 'INSERT', false),
    ('public.reviews', 'status', 'INSERT', false), ('public.reviews', 'rating', 'UPDATE', true),
    ('public.reviews', 'comment', 'UPDATE', true), ('public.reviews', 'status', 'UPDATE', false),
    ('public.reviews', 'tutor_id', 'UPDATE', false), ('public.reviews', 'student_id', 'UPDATE', false),
    ('public.questions', 'subject_id', 'INSERT', true), ('public.questions', 'title', 'INSERT', true),
    ('public.questions', 'body', 'INSERT', true), ('public.questions', 'author_id', 'INSERT', false),
    ('public.questions', 'status', 'INSERT', false), ('public.questions', 'answers_count', 'INSERT', false),
    ('public.questions', 'title', 'UPDATE', true), ('public.questions', 'status', 'UPDATE', false),
    ('public.questions', 'answers_count', 'UPDATE', false), ('public.questions', 'author_id', 'UPDATE', false),
    ('public.answers', 'question_id', 'INSERT', true), ('public.answers', 'body', 'INSERT', true),
    ('public.answers', 'tutor_id', 'INSERT', false), ('public.answers', 'status', 'INSERT', false),
    ('public.answers', 'body', 'UPDATE', true), ('public.answers', 'status', 'UPDATE', false),
    ('public.answers', 'question_id', 'UPDATE', false),
    ('public.reports', 'target_type', 'INSERT', true), ('public.reports', 'target_id', 'INSERT', true),
    ('public.reports', 'reason', 'INSERT', true), ('public.reports', 'details', 'INSERT', true),
    ('public.reports', 'reporter_id', 'INSERT', false), ('public.reports', 'status', 'INSERT', false),
    ('public.reports', 'status', 'UPDATE', false)
  ) v(tbl, col, priv, expected)
  loop
    perform tests.ok(has_column_privilege('authenticated', r.tbl, r.col, r.priv) = r.expected,
                     format('grant coluna: authenticated %s %s.%s = %s', r.priv, r.tbl, r.col, r.expected));
  end loop;

  for r in select * from (values
    -- públicas (anon + authenticated)
    ('public.search_tutors(text,text,text,integer,text,integer,integer,text,integer,integer)', true, true),
    ('public.search_questions(text,text,integer,integer)', true, true),
    ('public.plan_price(text,integer)', true, true),
    ('public.effective_plan(text,timestamptz)', true, true),
    ('public.is_admin()', true, true),
    ('public.is_public_tutor(uuid)', true, true),
    ('public.reviewer_name(public.reviews)', true, true),
    ('public.author_name(public.questions)', true, true),
    -- só logado
    ('public.become_tutor()', false, true),
    ('public.is_active_user()', false, true),
    ('public.start_conversation(uuid,text,smallint)', false, true),
    ('public.mark_read(uuid)', false, true),
    ('public.unread_count()', false, true),
    ('public.list_conversations()', false, true),
    ('public.is_participant(uuid)', false, true),
    ('public.shares_conversation(uuid)', false, true),
    ('public.can_review(uuid)', false, true),
    ('public.admin_moderate(text,text,text,bigint)', false, true),
    ('public.export_my_data()', false, true),
    ('public.can_report_message(text)', false, true),
    -- ninguém pela API
    ('public.apply_payment(uuid,text,text,integer,jsonb)', false, false),
    ('public.create_tutor_profile(uuid,text)', false, false),
    ('public.handle_new_user()', false, false),
    ('public.rate_limit()', false, false),
    ('public.tutor_before_write()', false, false),
    ('public.touch_tutor()', false, false),
    ('public.enforce_subject_limit()', false, false),
    ('public.after_message()', false, false),
    ('public.refresh_tutor_rating()', false, false),
    ('public.refresh_answers_count()', false, false),
    ('public.set_updated_at()', false, false),
    ('public.slugify(text)', false, false),
    ('public.short_name(text)', false, false),
    ('public.f_unaccent(text)', false, false)
  ) v(fn, anon_ok, auth_ok)
  loop
    perform tests.ok(has_function_privilege('anon', r.fn, 'EXECUTE') = r.anon_ok,
                     format('execute: anon %s = %s', r.fn, r.anon_ok));
    perform tests.ok(has_function_privilege('authenticated', r.fn, 'EXECUTE') = r.auth_ok,
                     format('execute: authenticated %s = %s', r.fn, r.auth_ok));
  end loop;
  perform tests.ok(has_function_privilege('service_role', 'public.apply_payment(uuid,text,text,integer,jsonb)', 'EXECUTE'),
                   'execute: service_role apply_payment = true');

  -- RLS ligado em todas as tabelas do portal
  perform tests.ok(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'RLS habilitado em todas as tabelas de public');
  -- security definer sempre com search_path fixo
  perform tests.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proconfig is null or not exists (
      select 1 from unnest(p.proconfig) c where c like 'search_path=%'))), 'toda função de public fixa search_path');
end $$;

-- =====================================================================
-- 2. Cadastro (handle_new_user)
-- =====================================================================
do $$
declare
  v_id uuid := gen_random_uuid();
  p public.profiles;
  v_slug text;
begin
  -- metadata tentando virar admin: vira aluno comum; nome nunca vem do e-mail
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'hacker.malicioso@teste.local', '{"role":"admin","is_admin":true,"full_name":"   "}');
  select * into p from public.profiles where id = v_id;
  perform tests.eq(p.role, 'student', 'signup: role desconhecido vira student');
  perform tests.ok(p.is_admin = false, 'signup: metadata não concede admin');
  perform tests.eq(p.full_name, 'Usuário', 'signup: nome vazio vira "Usuário" (nunca o e-mail)');
  perform tests.ok(p.terms_accepted_at is null, 'signup: sem accepted_terms não registra aceite');
  perform tests.ok(not exists (select 1 from public.tutor_profiles where user_id = v_id), 'signup: aluno não ganha anúncio');

  -- professor: anúncio despublicado, slug do nome e único
  v_id := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'outra.ana@teste.local', '{"role":"tutor","full_name":"  Ana   Silva ","accepted_terms":true}');
  select slug into v_slug from public.tutor_profiles where user_id = v_id;
  perform tests.eq(v_slug, 'ana-silva-2', 'signup: slug duplicado ganha sufixo -2');
  perform tests.eq((select full_name from public.profiles where id = v_id), 'Ana Silva', 'signup: nome normalizado');
  perform tests.ok((select role = 'tutor' and terms_accepted_at is not null from public.profiles where id = v_id),
                   'signup: professor com aceite dos termos');
  perform tests.ok((select not published and plan = 'basico' from public.tutor_profiles where user_id = v_id),
                   'signup: anúncio nasce despublicado no básico');

  -- nome longo truncado; login social usa "name"
  v_id := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'longo@teste.local', jsonb_build_object('full_name', repeat('x', 200)));
  perform tests.eq((select char_length(full_name)::text from public.profiles where id = v_id), '80', 'signup: nome truncado em 80');
  v_id := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'google@teste.local', '{"name":"Carlos Google"}');
  perform tests.eq((select full_name from public.profiles where id = v_id), 'Carlos Google', 'signup: usa "name" do login social');

  -- conta que já existia antes da migração (00_shim.sql) ganhou perfil de aluno
  perform tests.ok((select role = 'student' and full_name = 'Conta Antiga' and not is_admin
                    from public.profiles where id = tests.uid('antiga')),
                   'backfill: conta anterior à migração ganha perfil (aluno, nome normalizado)');

  perform tests.eq(public.short_name('Maria da Silva'), 'Maria S.', 'short_name: "Maria da Silva" -> "Maria S."');
  perform tests.eq(public.short_name('Maria'), 'Maria', 'short_name: nome único fica inteiro');
  perform tests.eq(public.slugify('Ana Maria  Sá!'), 'ana-maria-sa', 'slugify remove acentos e símbolos');
end $$;

-- =====================================================================
-- 3. profiles
-- =====================================================================
do $$
begin
  perform tests.anon();
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('ana'))::text, '1',
                   'profiles: anon lê perfil de professor');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('maria'))::text, '0',
                   'profiles: anon NÃO lê perfil de aluno');
  perform tests.eq((select count(*) from public.profiles where role = 'student')::text, '0',
                   'profiles: anon não lista nenhum aluno');
  perform tests.throws(format('update public.profiles set full_name = %L where id = %L', 'X', tests.uid('ana')),
                       '42501', 'profiles: anon não atualiza');

  perform tests.login('paula');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('paula'))::text, '1',
                   'profiles: usuário lê o próprio perfil');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('maria'))::text, '0',
                   'profiles: aluno não lê outro aluno sem conversa');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('ana'))::text, '1',
                   'profiles: logado lê professor');
  perform tests.eq(tests.affected(format('update public.profiles set full_name = %L where id = %L',
                   'Paula Oliveira', tests.uid('paula')))::text, '1', 'profiles: atualiza o próprio nome');
  perform tests.eq(tests.affected(format('update public.profiles set full_name = %L where id = %L',
                   'Hackeado', tests.uid('ana')))::text, '0', 'profiles: não atualiza perfil alheio');
  perform tests.throws(format('update public.profiles set role = %L where id = %L', 'tutor', tests.uid('paula')),
                       '42501', 'profiles: cliente não altera role');
  perform tests.throws(format('update public.profiles set is_admin = true where id = %L', tests.uid('paula')),
                       '42501', 'profiles: cliente não se torna admin');
  perform tests.throws(format('update public.profiles set banned_at = null where id = %L', tests.uid('paula')),
                       '42501', 'profiles: cliente não mexe em banned_at');
  perform tests.throws(format('update public.profiles set avatar_path = %L where id = %L',
                       tests.uid('ana')::text || '/a.webp', tests.uid('paula')),
                       '23514', 'profiles: avatar_path fora da própria pasta é recusado');
  perform tests.eq(tests.affected(format('update public.profiles set avatar_path = %L where id = %L',
                   tests.uid('paula')::text || '/avatar-1.webp', tests.uid('paula')))::text, '1',
                   'profiles: avatar_path na própria pasta');
  perform tests.throws(format('insert into public.profiles (id) values (%L)', gen_random_uuid()),
                       '42501', 'profiles: cliente não insere perfil');
  perform tests.throws(format('delete from public.profiles where id = %L', tests.uid('paula')),
                       '42501', 'profiles: cliente não apaga perfil');

  perform tests.login('admin');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('maria'))::text, '1',
                   'profiles: admin lê aluno');
  perform tests.ok(public.is_admin(), 'is_admin(): admin = true');
  perform tests.login('paula');
  perform tests.ok(not public.is_admin(), 'is_admin(): usuário comum = false');
  perform tests.anon();
  perform tests.ok(not public.is_admin(), 'is_admin(): anon = false');
end $$;

-- =====================================================================
-- 4. plans / subjects / funções de preço
-- =====================================================================
do $$
begin
  perform tests.anon();
  perform tests.eq((select count(*) from public.plans)::text, '3', 'plans: anon lê os 3 planos');
  perform tests.eq((select name from public.subjects where slug = 'matematica'), 'Matemática', 'subjects: slug sem acento');
  perform tests.ok((select count(*) >= 46 from public.subjects), 'subjects: catálogo completo (46+)');
  perform tests.eq((select slug from public.subjects where name = 'Piano e Teclado'), 'piano-e-teclado', 'subjects: slug composto');
  perform tests.eq(public.plan_price('profissional', 1)::text, '2990', 'plan_price: profissional 1 mês');
  perform tests.eq(public.plan_price('profissional', 3)::text, '8073', 'plan_price: profissional 3 meses (-10%)');
  perform tests.eq(public.plan_price('profissional', 12)::text, '26910', 'plan_price: profissional 12 meses (-25%)');
  perform tests.eq(public.plan_price('premium', 12)::text, '53910', 'plan_price: premium 12 meses');
  perform tests.throws($q$select public.plan_price('basico', 1)$q$, 'P0001', 'plan_price: básico não é vendável');
  perform tests.throws($q$select public.plan_price('premium', 2)$q$, 'P0001', 'plan_price: período inválido');
  perform tests.throws($q$select public.plan_price('ouro', 1)$q$, 'P0001', 'plan_price: plano inexistente');
  perform tests.eq(public.effective_plan('premium', now() + interval '1 day'), 'premium', 'effective_plan: vigente');
  perform tests.eq(public.effective_plan('premium', now() - interval '1 day'), 'basico', 'effective_plan: vencido = básico');
  perform tests.eq(public.effective_plan('premium', null), 'basico', 'effective_plan: sem validade = básico');

  perform tests.login('paula');
  perform tests.throws($q$update public.plans set price_cents_month = 1$q$, '42501', 'plans: cliente não altera preço');
  perform tests.throws($q$insert into public.subjects (slug, name, category) values ('x', 'X', 'Y')$q$,
                       '42501', 'subjects: cliente não cria matéria');
end $$;

-- =====================================================================
-- 5. tutor_profiles: leitura, escrita por coluna
-- =====================================================================
do $$
begin
  perform tests.anon();
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('ana'))::text, '1',
                   'tutor_profiles: anon lê anúncio publicado');
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('otavio'))::text, '0',
                   'tutor_profiles: anon NÃO lê anúncio despublicado');
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('silvia'))::text, '0',
                   'tutor_profiles: anon NÃO lê anúncio suspenso');
  perform tests.throws(format('update public.tutor_profiles set headline = %L where user_id = %L', 'x', tests.uid('ana')),
                       '42501', 'tutor_profiles: anon não atualiza');

  perform tests.login('otavio');
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('otavio'))::text, '1',
                   'tutor_profiles: dono lê o próprio anúncio despublicado');
  perform tests.login('silvia');
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('silvia'))::text, '1',
                   'tutor_profiles: dono lê o próprio anúncio suspenso');
  perform tests.login('admin');
  perform tests.eq((select count(*) from public.tutor_profiles where user_id in (tests.uid('otavio'), tests.uid('silvia')))::text,
                   '2', 'tutor_profiles: admin lê despublicado e suspenso');

  perform tests.login('teresa');
  perform tests.eq(tests.affected(format('update public.tutor_profiles set headline = %L, bio = %L where user_id = %L',
                   'Xadrez do básico ao avançado', 'Enxadrista federada.', tests.uid('teresa')))::text, '1',
                   'tutor_profiles: dono edita campos liberados');
  perform tests.eq(tests.affected(format('update public.tutor_profiles set headline = %L where user_id = %L',
                   'Hackeado', tests.uid('ana')))::text, '0', 'tutor_profiles: não edita anúncio alheio');
  perform tests.throws(format('update public.tutor_profiles set plan = %L where user_id = %L', 'premium', tests.uid('teresa')),
                       '42501', 'tutor_profiles: cliente não altera plan');
  perform tests.throws(format('update public.tutor_profiles set plan_expires_at = now() + interval ''1 year'' where user_id = %L',
                       tests.uid('teresa')), '42501', 'tutor_profiles: cliente não altera plan_expires_at');
  perform tests.throws(format('update public.tutor_profiles set rating_avg = 5 where user_id = %L', tests.uid('teresa')),
                       '42501', 'tutor_profiles: cliente não altera rating_avg');
  perform tests.throws(format('update public.tutor_profiles set rating_count = 99 where user_id = %L', tests.uid('teresa')),
                       '42501', 'tutor_profiles: cliente não altera rating_count');
  perform tests.throws(format('update public.tutor_profiles set suspended = false where user_id = %L', tests.uid('teresa')),
                       '42501', 'tutor_profiles: cliente não altera suspended');
  perform tests.throws(format('update public.tutor_profiles set search_tsv = null where user_id = %L', tests.uid('teresa')),
                       '42501', 'tutor_profiles: cliente não altera search_tsv');
  perform tests.throws(format('insert into public.tutor_profiles (user_id, slug) values (%L, %L)', tests.uid('paula'), 'paula-x'),
                       '42501', 'tutor_profiles: cliente não cria anúncio direto');
  perform tests.throws(format('delete from public.tutor_profiles where user_id = %L', tests.uid('teresa')),
                       '42501', 'tutor_profiles: cliente não apaga anúncio');
  perform tests.throws(format('update public.tutor_profiles set slug = %L where user_id = %L', 'ana-silva', tests.uid('teresa')),
                       '23505', 'tutor_profiles: slug é único');
  perform tests.throws(format('update public.tutor_profiles set slug = %L where user_id = %L', 'Slug Inválido', tests.uid('teresa')),
                       '23514', 'tutor_profiles: formato de slug validado');
end $$;

-- =====================================================================
-- 6. become_tutor + validação de publicação
-- =====================================================================
do $$
declare
  v_slug text;
begin
  perform tests.anon();
  perform tests.throws($q$select public.become_tutor()$q$, '42501', 'become_tutor: anon não executa');
  perform tests.throws(format('select public.create_tutor_profile(%L, %L)', tests.uid('paula'), 'x'),
                       '42501', 'create_tutor_profile: interna (anon)');

  perform tests.login('leo');
  perform tests.throws(format('select public.create_tutor_profile(%L, %L)', tests.uid('leo'), 'x'),
                       '42501', 'create_tutor_profile: interna (authenticated)');
  perform tests.throws($q$select public.slugify('x')$q$, '42501', 'slugify: interna (authenticated)');
  v_slug := public.become_tutor();
  perform tests.eq(v_slug, 'leo-futuro', 'become_tutor: cria anúncio e devolve slug');
  perform tests.eq(public.become_tutor(), 'leo-futuro', 'become_tutor: idempotente');
  perform tests.eq((select role from public.profiles where id = tests.uid('leo')), 'tutor', 'become_tutor: role = tutor');

  -- publicar anúncio incompleto falha (cada regra)
  perform tests.throws(format('update public.tutor_profiles set published = true where user_id = %L', tests.uid('leo')),
                       'P0001', 'publicação: exige título', '%título%');
  perform tests.throws(format('update public.tutor_profiles set headline = %L, published = true where user_id = %L',
                       'Física para o ENEM', tests.uid('leo')), 'P0001', 'publicação: exige valor da hora', '%hora-aula%');
  perform tests.throws(format('update public.tutor_profiles set headline = %L, hourly_rate_cents = 5000, mode_online = false,
                       mode_presencial = false, published = true where user_id = %L', 'Física para o ENEM', tests.uid('leo')),
                       'P0001', 'publicação: exige online ou presencial', '%online%');
  perform tests.throws(format('update public.tutor_profiles set headline = %L, hourly_rate_cents = 5000, mode_online = false,
                       mode_presencial = true, published = true where user_id = %L', 'Física para o ENEM', tests.uid('leo')),
                       'P0001', 'publicação: presencial exige cidade', '%cidade%');
  perform tests.throws(format('update public.tutor_profiles set headline = %L, hourly_rate_cents = 5000, published = true
                       where user_id = %L', 'Física para o ENEM', tests.uid('leo')),
                       'P0001', 'publicação: exige ao menos uma matéria', '%matéria%');
  perform tests.eq((select published::text from public.tutor_profiles where user_id = tests.uid('leo')), 'false',
                   'publicação: anúncio incompleto segue despublicado');

  -- completo: publica
  update public.tutor_profiles set headline = 'Física para o ENEM', hourly_rate_cents = 5000, mode_online = true,
         mode_presencial = true, uf = 'RJ', city_ibge = 3304557, city_name = 'Rio de Janeiro'
   where user_id = tests.uid('leo');
  insert into public.tutor_subjects (tutor_id, subject_id, levels)
    select tests.uid('leo'), id, '{medio,vestibular}' from public.subjects where slug = 'fisica';
  perform tests.eq(tests.affected(format('update public.tutor_profiles set published = true where user_id = %L',
                   tests.uid('leo')))::text, '1', 'publicação: anúncio completo publica');
  perform tests.anon();
  perform tests.eq((select count(*) from public.tutor_profiles where slug = 'leo-futuro')::text, '1',
                   'publicação: anúncio publicado fica visível ao anon');
end $$;

-- =====================================================================
-- 7. tutor_subjects + limite de matérias por plano
-- =====================================================================
do $$
begin
  perform tests.login('teresa');
  insert into public.tutor_subjects (tutor_id, subject_id)
    select tests.uid('teresa'), id from public.subjects where slug in ('fisica', 'quimica');
  perform tests.eq((select count(*) from public.tutor_subjects where tutor_id = tests.uid('teresa'))::text, '3',
                   'tutor_subjects: professor adiciona as próprias matérias');
  perform tests.throws(format('insert into public.tutor_subjects (tutor_id, subject_id) select %L, id from public.subjects where slug = %L',
                       tests.uid('teresa'), 'biologia'), 'P0001', 'limite: 4ª matéria no básico falha', '%até 3 matérias%');
  -- upsert de matéria existente no limite não é barrado pelo limite
  perform tests.eq(tests.affected(format('insert into public.tutor_subjects (tutor_id, subject_id, levels) select %L, id, %L
                   from public.subjects where slug = %L on conflict (tutor_id, subject_id) do update set levels = excluded.levels',
                   tests.uid('teresa'), '{adulto}', 'xadrez'))::text, '1', 'limite: upsert de matéria existente passa');
  perform tests.throws(format('insert into public.tutor_subjects (tutor_id, subject_id) select %L, id from public.subjects where slug = %L',
                       tests.uid('ana'), 'xadrez'), '42501', 'tutor_subjects: não insere matéria em anúncio alheio');
  perform tests.eq(tests.affected(format('update public.tutor_subjects set levels = %L where tutor_id = %L',
                   '{medio}', tests.uid('teresa')))::text, '3', 'tutor_subjects: atualiza níveis próprios');
  perform tests.eq(tests.affected(format('update public.tutor_subjects set levels = %L where tutor_id = %L',
                   '{medio}', tests.uid('ana')))::text, '0', 'tutor_subjects: não atualiza níveis alheios');
  perform tests.eq(tests.affected(format('delete from public.tutor_subjects where tutor_id = %L', tests.uid('ana')))::text,
                   '0', 'tutor_subjects: não apaga matérias alheias');
  perform tests.throws(format('update public.tutor_subjects set subject_id = 1 where tutor_id = %L', tests.uid('teresa')),
                       '42501', 'tutor_subjects: não troca subject_id (só levels)');
  perform tests.throws(format('update public.tutor_subjects set levels = %L where tutor_id = %L', '{doutorado}', tests.uid('teresa')),
                       '23514', 'tutor_subjects: nível inválido recusado');
  perform tests.anon();
  perform tests.ok((select count(*) > 0 from public.tutor_subjects where tutor_id = tests.uid('ana')),
                   'tutor_subjects: anon lê matérias');
  perform tests.throws(format('insert into public.tutor_subjects (tutor_id, subject_id) values (%L, 1)', tests.uid('ana')),
                       '42501', 'tutor_subjects: anon não insere');

  -- profissional vigente: pode mais; vencido: volta ao limite do básico
  perform tests.su();
  update public.tutor_profiles set plan = 'profissional', plan_expires_at = now() + interval '30 days'
   where user_id = tests.uid('teresa');
  perform tests.login('teresa');
  insert into public.tutor_subjects (tutor_id, subject_id)
    select tests.uid('teresa'), id from public.subjects where slug = 'biologia';
  perform tests.eq((select count(*) from public.tutor_subjects where tutor_id = tests.uid('teresa'))::text, '4',
                   'limite: plano profissional vigente permite 4ª matéria');
  perform tests.su();
  update public.tutor_profiles set plan_expires_at = now() - interval '1 day' where user_id = tests.uid('teresa');
  perform tests.login('teresa');
  perform tests.throws(format('insert into public.tutor_subjects (tutor_id, subject_id) select %L, id from public.subjects where slug = %L',
                       tests.uid('teresa'), 'historia'), 'P0001', 'limite: plano vencido volta ao limite do básico');
  perform tests.su();
  update public.tutor_profiles set plan = 'basico', plan_expires_at = null where user_id = tests.uid('teresa');
  -- tsvector reconstruído com as matérias novas
  perform tests.anon();
  perform tests.ok(exists (select 1 from public.search_tutors(q => 'biologia') where slug = 'teresa-tutora'),
                   'busca: tsvector inclui matéria adicionada depois');
end $$;

-- =====================================================================
-- 8. search_tutors
-- =====================================================================
do $$
declare
  r record;
  n int;
  v_arr int[];
begin
  perform tests.anon();
  select * into r from public.search_tutors(q => 'matematica') limit 1;
  perform tests.eq(r.slug, 'ana-silva', 'search_tutors: premium primeiro');
  perform tests.eq(r.plan, 'premium', 'search_tutors: devolve plano efetivo');
  perform tests.ok('Matemática' = any (r.subjects), 'search_tutors: devolve matérias');
  perform tests.ok(r.total >= 2, 'search_tutors: total = contagem geral');
  perform tests.ok(exists (select 1 from public.search_tutors(q => 'matematica') where slug = 'gabriela-nunes'),
                   'search_tutors: "matematica" encontra "Matemática"');
  perform tests.eq((select count(*) from public.search_tutors(q => 'Matemática'))::text,
                   (select count(*) from public.search_tutors(q => 'matematica'))::text,
                   'search_tutors: com ou sem acento dá o mesmo resultado');
  perform tests.eq((select string_agg(plan, ',' order by ordinality) from (
                     select plan, ordinality from public.search_tutors() with ordinality limit 2) s),
                   'premium,profissional', 'search_tutors: ordem padrão por tier do plano');
  perform tests.ok(not exists (select 1 from public.search_tutors(q => 'xadrez', p_lim => 50)
                               where slug in ('otavio-oculto', 'silvia-suspensa')),
                   'search_tutors: exclui despublicado e suspenso');
  perform tests.ok(exists (select 1 from public.search_tutors(q => 'xadrez') where slug = 'teresa-tutora'),
                   'search_tutors: inclui publicado');
  perform tests.ok((select bool_and('Inglês' = any (subjects)) and count(*) >= 1
                    from public.search_tutors(p_materia => 'ingles')), 'search_tutors: filtro por matéria');
  perform tests.ok((select bool_and(hourly_rate_cents <= 5500) and count(*) >= 1
                    from public.search_tutors(p_preco_max => 5500, p_lim => 50)), 'search_tutors: preço máximo');
  perform tests.ok((select bool_and(hourly_rate_cents >= 8000) and count(*) >= 1
                    from public.search_tutors(p_preco_min => 8000, p_lim => 50)), 'search_tutors: preço mínimo');
  select array_agg(hourly_rate_cents order by ordinality) into v_arr
    from public.search_tutors(p_ordem => 'preco_asc', p_lim => 50) with ordinality;
  perform tests.ok(v_arr = (select array_agg(x order by x) from unnest(v_arr) x), 'search_tutors: preco_asc ordena por preço');
  perform tests.ok((select slug from public.search_tutors(p_ordem => 'preco_asc') limit 1) <> 'ana-silva',
                   'search_tutors: ordem por preço ignora o tier');
  select array_agg(hourly_rate_cents order by ordinality) into v_arr
    from public.search_tutors(p_ordem => 'preco_desc', p_lim => 50) with ordinality;
  perform tests.ok(v_arr = (select array_agg(x order by x desc) from unnest(v_arr) x), 'search_tutors: preco_desc');
  perform tests.ok((select bool_and(mode_presencial and uf = 'SP') and count(*) >= 2
                    from public.search_tutors(p_modo => 'presencial', p_uf => 'SP', p_cidade => 3550308)),
                   'search_tutors: presencial filtra por cidade');
  perform tests.ok((select bool_and(mode_online) from public.search_tutors(p_modo => 'online', p_lim => 50)),
                   'search_tutors: modo online');
  perform tests.ok(not exists (select 1 from public.search_tutors(p_uf => 'RJ', p_cidade => 3304557, p_lim => 50)
                               where slug = 'eduarda-lima'), 'search_tutors: presencial de outra cidade fica fora');
  perform tests.ok(exists (select 1 from public.search_tutors(p_uf => 'SP', p_cidade => 3550308, p_lim => 50)
                           where slug = 'eduarda-lima'), 'search_tutors: presencial da cidade entra');
  perform tests.eq((select slug from public.search_tutors(p_cidade => 4205407, p_uf => 'SC') offset 2 limit 1),
                   'gabriela-nunes', 'search_tutors: depois do tier, professor local primeiro');
  select count(*) into n from public.search_tutors(p_lim => 2);
  perform tests.eq(n::text, '2', 'search_tutors: p_lim');
  perform tests.ok(not exists (select slug from public.search_tutors(p_lim => 2)
                               intersect select slug from public.search_tutors(p_lim => 2, p_pagina => 1)),
                   'search_tutors: paginação sem repetição');
  perform tests.eq((select count(*) from public.search_tutors(q => 'de', p_lim => 50))::text,
                   (select count(*) from public.search_tutors(p_lim => 50))::text,
                   'search_tutors: consulta só com stopwords não filtra');

  -- trocar o nome no perfil reconstrói o índice de busca do anúncio
  perform tests.login('leo');
  update public.profiles set full_name = 'Leo Futuro Einstein' where id = tests.uid('leo');
  perform tests.anon();
  perform tests.ok(exists (select 1 from public.search_tutors(q => 'einstein') where slug = 'leo-futuro'),
                   'search_tutors: nome novo entra na busca');

  -- premium vencido conta como básico
  perform tests.su();
  update public.tutor_profiles set plan_expires_at = now() - interval '1 day' where user_id = tests.uid('ana');
  perform tests.anon();
  perform tests.eq((select plan from public.search_tutors(q => 'matematica') where slug = 'ana-silva'), 'basico',
                   'search_tutors: premium vencido aparece como básico');
  perform tests.ok((select slug from public.search_tutors() limit 1) <> 'ana-silva',
                   'search_tutors: premium vencido perde o topo');
  perform tests.su();
  update public.tutor_profiles set plan_expires_at = now() + interval '30 days' where user_id = tests.uid('ana');
end $$;

-- =====================================================================
-- 9. storage (avatars)
-- =====================================================================
do $$
declare
  v_paula text := tests.uid('paula')::text;
begin
  perform tests.ok((select public and file_size_limit = 2097152 and allowed_mime_types @> array['image/webp']
                    from storage.buckets where id = 'avatars'), 'storage: bucket avatars público, 2 MB, webp');
  perform tests.login('paula');
  insert into storage.objects (bucket_id, name) values ('avatars', v_paula || '/avatar-1.webp');
  perform tests.ok(true, 'storage: sobe na própria pasta');
  perform tests.throws(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'avatars',
                       tests.uid('maria')::text || '/avatar.webp'), '42501', 'storage: não sobe na pasta alheia');
  perform tests.throws(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'avatars', 'avatar.webp'),
                       '42501', 'storage: não sobe fora de pasta');
  perform tests.eq((select count(*) from storage.objects where name like v_paula || '/%')::text, '1',
                   'storage: lê os próprios arquivos');
  perform tests.eq(tests.affected(format('update storage.objects set name = %L where name = %L',
                   v_paula || '/avatar-2.webp', v_paula || '/avatar-1.webp'))::text, '1', 'storage: renomeia na própria pasta');
  perform tests.throws(format('update storage.objects set name = %L where name = %L',
                       tests.uid('maria')::text || '/x.webp', v_paula || '/avatar-2.webp'),
                       '42501', 'storage: não move para pasta alheia');

  perform tests.login('rafael');
  perform tests.eq((select count(*) from storage.objects where name like v_paula || '/%')::text, '0',
                   'storage: não lista arquivos alheios');
  perform tests.eq(tests.affected(format('delete from storage.objects where name like %L', v_paula || '/%'))::text, '0',
                   'storage: não apaga arquivos alheios');
  perform tests.anon();
  perform tests.throws(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'avatars', v_paula || '/z.webp'),
                       '42501', 'storage: anon não sobe arquivo');

  perform tests.login('paula');
  perform tests.eq(tests.affected(format('delete from storage.objects where name like %L', v_paula || '/%'))::text, '1',
                   'storage: apaga o próprio arquivo');
end $$;

-- =====================================================================
-- 10. mensagens
-- =====================================================================
-- 10a. aluno abre conversa
do $$
declare
  v_conv uuid;
begin
  perform tests.login('paula');
  v_conv := public.start_conversation(tests.uid('teresa'), 'Olá, Teresa! Quero aulas de xadrez.');
  perform tests.ok(v_conv is not null, 'start_conversation: cria conversa');
  perform tests.eq(public.start_conversation(tests.uid('teresa'), 'Tenho horário à noite.', null)::text, v_conv::text,
                   'start_conversation: reaproveita a conversa do par');
  perform tests.eq((select count(*) from public.messages where conversation_id = v_conv)::text, '2',
                   'start_conversation: grava as mensagens');
  perform tests.eq((select sender_id from public.messages where conversation_id = v_conv order by id limit 1)::text,
                   tests.uid('paula')::text, 'start_conversation: remetente = usuário logado');
  perform tests.throws(format('select public.start_conversation(%L, %L)', tests.uid('otavio'), 'Oi'),
                       'P0001', 'start_conversation: professor despublicado', '%não encontrado%');
  perform tests.throws(format('select public.start_conversation(%L, %L)', tests.uid('silvia'), 'Oi'),
                       'P0001', 'start_conversation: professor suspenso', '%não encontrado%');
  perform tests.throws(format('select public.start_conversation(%L, %L)', tests.uid('maria'), 'Oi'),
                       'P0001', 'start_conversation: destinatário precisa ser professor', '%não encontrado%');
  perform tests.throws(format('select public.start_conversation(%L, %L)', tests.uid('ana'), '   '),
                       'P0001', 'start_conversation: mensagem vazia');
  perform tests.throws(format('select public.start_conversation(%L, %L, 9999::smallint)', tests.uid('ana'), 'Oi'),
                       'P0001', 'start_conversation: matéria inválida');
  perform tests.throws(format('insert into public.conversations (student_id, tutor_id) values (%L, %L)',
                       tests.uid('paula'), tests.uid('ana')), '42501', 'conversations: cliente não insere direto');
  perform tests.throws(format('update public.conversations set tutor_last_read_at = now() where id = %L', v_conv),
                       '42501', 'conversations: cliente não atualiza direto');
  perform tests.throws(format('delete from public.conversations where id = %L', v_conv),
                       '42501', 'conversations: cliente não apaga');

  perform tests.login('teresa');
  perform tests.throws(format('select public.start_conversation(%L, %L)', tests.uid('teresa'), 'Oi'),
                       'P0001', 'start_conversation: não conversa consigo mesmo', '%si mesmo%');
  perform tests.anon();
  perform tests.throws(format('select public.start_conversation(%L, %L)', tests.uid('ana'), 'Oi'),
                       '42501', 'start_conversation: anon não executa');
  perform tests.throws($q$select public.unread_count()$q$, '42501', 'unread_count: anon não executa');
  perform tests.throws($q$select * from public.list_conversations()$q$, '42501', 'list_conversations: anon não executa');
  perform tests.throws(format('select public.mark_read(%L)', v_conv), '42501', 'mark_read: anon não executa');
  perform tests.throws($q$select count(*) from public.messages$q$, '42501', 'messages: anon não lê');
end $$;

-- 10b. professor lê, marca como lida e responde; terceiros não veem nada
do $$
declare
  v_conv uuid;
  r record;
begin
  perform tests.su();
  select id into v_conv from public.conversations
   where student_id = tests.uid('paula') and tutor_id = tests.uid('teresa');

  perform tests.login('teresa');
  perform tests.eq(public.unread_count()::text, '1', 'unread_count: professor tem 1 conversa não lida');
  select * into r from public.list_conversations();
  perform tests.eq(r.other_name, 'Paula O.', 'list_conversations: professor vê o aluno com nome abreviado');
  perform tests.eq(r.i_am, 'tutor', 'list_conversations: papel do usuário');
  perform tests.ok(r.other_slug is null, 'list_conversations: aluno não tem slug');
  perform tests.ok(r.unread, 'list_conversations: marca não lida');
  perform tests.eq(r.last_body, 'Tenho horário à noite.', 'list_conversations: prévia da última mensagem');
  perform public.mark_read(v_conv);
  perform tests.eq(public.unread_count()::text, '0', 'mark_read: zera não lidas');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('paula'))::text, '0',
                   'profiles: professor não lê a linha do aluno (privacidade)');
  insert into public.messages (conversation_id, body) values (v_conv, 'Oi, Paula! Podemos começar terça.');
  perform tests.eq((select sender_id from public.messages where conversation_id = v_conv order by id desc limit 1)::text,
                   tests.uid('teresa')::text, 'messages: sender_id preenchido pelo banco');
  perform tests.throws(format('insert into public.messages (conversation_id, sender_id, body) values (%L, %L, %L)',
                       v_conv, tests.uid('paula'), 'falsa'), '42501', 'messages: não forja sender_id');
  perform tests.throws(format('update public.messages set body = %L where conversation_id = %L', 'editada', v_conv),
                       '42501', 'messages: não edita');
  perform tests.throws(format('delete from public.messages where conversation_id = %L', v_conv),
                       '42501', 'messages: não apaga');
  perform tests.throws(format('insert into public.messages (conversation_id, body) values (%L, %L)', v_conv, '   '),
                       '23514', 'messages: corpo vazio recusado');

  perform tests.login('ana');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('paula'))::text, '0',
                   'profiles: professor sem conversa não lê o aluno');
  perform tests.login('tiago');
  perform tests.eq((select count(*) from public.messages where conversation_id = v_conv)::text, '0',
                   'messages: terceiro vê 0 mensagens alheias');
  perform tests.eq((select count(*) from public.conversations where id = v_conv)::text, '0',
                   'conversations: terceiro não vê conversa alheia');
  perform tests.eq((select count(*) from public.list_conversations())::text, '0', 'list_conversations: só as próprias');
  perform tests.ok(not public.is_participant(v_conv), 'is_participant: terceiro = false');
  perform tests.throws(format('insert into public.messages (conversation_id, body) values (%L, %L)', v_conv, 'intrometido'),
                       '42501', 'messages: terceiro não escreve em conversa alheia');
  perform public.mark_read(v_conv); -- não afeta nada
  perform tests.su();
  perform tests.ok((select tutor_last_read_at > 'epoch' and student_last_read_at is not null
                    from public.conversations where id = v_conv), 'mark_read: terceiro não altera a conversa');
end $$;

-- 10c. aluno vê a resposta
do $$
declare
  r record;
begin
  perform tests.login('paula');
  perform tests.eq(public.unread_count()::text, '1', 'unread_count: aluno vê resposta como não lida');
  select * into r from public.list_conversations();
  perform tests.eq(r.i_am, 'student', 'list_conversations: aluno');
  perform tests.eq(r.other_slug, 'teresa-tutora', 'list_conversations: slug do professor');
  perform tests.eq(r.other_name, 'Teresa Tutora', 'list_conversations: nome do professor');
  perform tests.eq(r.last_body, 'Oi, Paula! Podemos começar terça.', 'list_conversations: última mensagem');
  perform tests.ok(public.is_participant(r.id), 'is_participant: aluno = true');
  perform tests.eq((select count(*) from public.messages where conversation_id = r.id)::text, '3',
                   'messages: participante lê todas');
  perform public.mark_read(r.id);
  perform tests.eq(public.unread_count()::text, '0', 'mark_read: aluno zera');
  perform tests.ok((select last_active_at is not null from public.tutor_profiles where user_id = tests.uid('teresa')),
                   'after_message: registra atividade do professor');
end $$;

-- 10d. banido não envia; conversa para avaliar depois (bia ↔ teresa)
do $$
declare
  v_conv uuid;
begin
  perform tests.login('bia');
  v_conv := public.start_conversation(tests.uid('teresa'), 'Oi, quero aula.');
  perform tests.login('teresa');
  insert into public.messages (conversation_id, body) values (v_conv, 'Oi, Beatriz! Vamos sim.');
  perform tests.su();
  update public.profiles set banned_at = now() where id = tests.uid('bia');
  perform tests.login('bia');
  perform tests.ok(not public.is_active_user(), 'is_active_user: banido = false');
  perform tests.throws(format('insert into public.messages (conversation_id, body) values (%L, %L)', v_conv, 'ainda aqui'),
                       '42501', 'messages: banido não envia');
  perform tests.throws(format('select public.start_conversation(%L, %L)', tests.uid('ana'), 'Oi'),
                       'P0001', 'start_conversation: banido não abre conversa', '%suspensa%');
  perform tests.throws($q$select public.become_tutor()$q$, 'P0001', 'become_tutor: banido não vira professor');
  perform tests.eq((select count(*) from public.messages where conversation_id = v_conv)::text, '2',
                   'messages: banido ainda lê o histórico');
  perform tests.login('paula');
  perform tests.ok(public.is_active_user(), 'is_active_user: ativo = true');
end $$;

-- 10e. rate limit de mensagens (60 / 10 min)
do $$
declare
  v_conv uuid;
begin
  perform tests.login('rafael');
  v_conv := public.start_conversation(tests.uid('teresa'), 'Mensagem 1');
  for i in 2..60 loop
    insert into public.messages (conversation_id, body) values (v_conv, 'Mensagem ' || i);
  end loop;
  perform tests.eq((select count(*) from public.messages where conversation_id = v_conv)::text, '60',
                   'rate_limit: 60 mensagens em 10 min passam');
  perform tests.throws(format('insert into public.messages (conversation_id, body) values (%L, %L)', v_conv, 'Mensagem 61'),
                       'P0001', 'rate_limit: 61ª mensagem bloqueada', '%Limite atingido%');
end $$;

-- 10f. limite de 10 contatos novos por dia
do $$
declare
  v_first uuid;
begin
  for i in 1..11 loop
    perform tests.new_tutor(('00000000-0000-4000-d000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'Extra Tutor ' || i, true);
  end loop;
  perform tests.login('tiago');
  for i in 1..10 loop
    perform public.start_conversation(('00000000-0000-4000-d000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'Olá!');
  end loop;
  perform tests.ok(true, 'start_conversation: 10 contatos novos no dia passam');
  perform tests.throws(format('select public.start_conversation(%L, %L)', '00000000-0000-4000-d000-000000000011', 'Olá!'),
                       'P0001', 'start_conversation: 11º contato novo no dia bloqueado', '%10 novos contatos%');
  v_first := public.start_conversation('00000000-0000-4000-d000-000000000001', 'Continuando…');
  perform tests.ok(v_first is not null, 'start_conversation: conversa existente continua liberada após o limite');
end $$;

do $$
begin
  perform tests.ok(exists (select 1 from pg_publication_tables
                           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'),
                   'realtime: messages na publication supabase_realtime');
end $$;

-- =====================================================================
-- 11. avaliações
-- =====================================================================
do $$
declare
  v_id bigint;
begin
  -- sem resposta do professor: não avalia
  perform tests.login('rafael');
  perform tests.ok(not public.can_review(tests.uid('teresa')), 'can_review: sem resposta do professor = false');
  perform tests.throws(format('insert into public.reviews (tutor_id, rating) values (%L, 5)', tests.uid('teresa')),
                       '42501', 'reviews: avaliação sem resposta do professor falha');
  perform tests.login('tiago');
  perform tests.throws(format('insert into public.reviews (tutor_id, rating) values (%L, 5)', tests.uid('ana')),
                       '42501', 'reviews: sem conversa não avalia');
  perform tests.login('teresa');
  perform tests.throws(format('insert into public.reviews (tutor_id, rating) values (%L, 5)', tests.uid('teresa')),
                       '42501', 'reviews: professor não se autoavalia');
  perform tests.login('bia');
  perform tests.ok(public.can_review(tests.uid('teresa')), 'can_review: banida teve resposta');
  perform tests.throws(format('insert into public.reviews (tutor_id, rating) values (%L, 5)', tests.uid('teresa')),
                       '42501', 'reviews: banido não avalia');
  perform tests.anon();
  perform tests.throws(format('insert into public.reviews (tutor_id, rating) values (%L, 5)', tests.uid('teresa')),
                       '42501', 'reviews: anon não avalia');
  perform tests.throws(format('select public.can_review(%L)', tests.uid('teresa')), '42501', 'can_review: anon não executa');

  -- com resposta: avalia e atualiza a nota
  perform tests.login('paula');
  perform tests.ok(public.can_review(tests.uid('teresa')), 'can_review: com resposta do professor = true');
  insert into public.reviews (tutor_id, rating, comment) values (tests.uid('teresa'), 4, 'Ótima professora de xadrez.')
    returning id into v_id;
  perform tests.eq((select student_id from public.reviews where id = v_id)::text, tests.uid('paula')::text,
                   'reviews: student_id = usuário logado');
  perform tests.eq((select rating_avg::text || '/' || rating_count from public.tutor_profiles where user_id = tests.uid('teresa')),
                   '4.00/1', 'reviews: trigger atualiza média e contagem');
  perform tests.throws(format('insert into public.reviews (tutor_id, rating) values (%L, 5)', tests.uid('teresa')),
                       '23505', 'reviews: uma avaliação por aluno/professor');
  perform tests.throws(format('insert into public.reviews (tutor_id, student_id, rating) values (%L, %L, 5)',
                       tests.uid('ana'), tests.uid('maria')), '42501', 'reviews: não forja student_id');
  perform tests.throws(format('insert into public.reviews (tutor_id, rating, status) values (%L, 5, %L)',
                       tests.uid('ana'), 'published'), '42501', 'reviews: não define status');
  perform tests.eq(tests.affected(format('update public.reviews set rating = 2 where id = %L', v_id))::text, '1',
                   'reviews: edita a própria');
  perform tests.eq((select rating_avg::text from public.tutor_profiles where user_id = tests.uid('teresa')), '2.00',
                   'reviews: edição recalcula a média');
  perform tests.throws(format('update public.reviews set rating = 6 where id = %L', v_id), '23514', 'reviews: nota 1–5');
  perform tests.throws(format('update public.reviews set status = %L where id = %L', 'published', v_id),
                       '42501', 'reviews: autor não mexe no status');
  perform tests.throws(format('update public.reviews set tutor_id = %L where id = %L', tests.uid('ana'), v_id),
                       '42501', 'reviews: não troca o professor');
  perform tests.eq(tests.affected(format('update public.reviews set rating = 1 where student_id = %L', tests.uid('maria')))::text,
                   '0', 'reviews: não edita avaliação alheia');
  perform tests.login('rafael');
  perform tests.eq(tests.affected(format('delete from public.reviews where id = %L', v_id))::text, '0',
                   'reviews: não apaga avaliação alheia');

  perform tests.anon();
  perform tests.eq((select count(*) from public.reviews where tutor_id = tests.uid('teresa'))::text, '1',
                   'reviews: anon lê publicadas');
  perform tests.eq((select public.reviewer_name(r) from public.reviews r where r.id = v_id), 'Paula O.',
                   'reviewer_name: nome abreviado');
  perform tests.eq((select public.reviewer_name(r) from public.reviews r where r.tutor_id = tests.uid('ana')), 'Maria S.',
                   'reviewer_name: seed "Maria S."');
  perform tests.ok(public.reviewer_name(jsonb_populate_record(null::public.reviews,
                     jsonb_build_object('id', 999999, 'student_id', tests.uid('maria')))) is null,
                   'reviewer_name: linha forjada não revela nomes');

  -- apagar recalcula; volta a avaliar para os testes de moderação
  perform tests.login('paula');
  perform tests.eq(tests.affected(format('delete from public.reviews where id = %L', v_id))::text, '1', 'reviews: apaga a própria');
  perform tests.eq((select rating_avg::text || '/' || rating_count from public.tutor_profiles where user_id = tests.uid('teresa')),
                   '0.00/0', 'reviews: exclusão recalcula a nota');
  insert into public.reviews (tutor_id, rating, comment) values (tests.uid('teresa'), 5, 'Excelente!');
end $$;

-- =====================================================================
-- 12. tira-dúvidas
-- =====================================================================
do $$
declare
  v_q bigint;
  v_q2 bigint;
  v_seed bigint;
  v_xadrez smallint := (select id from public.subjects where slug = 'xadrez');
begin
  select id into v_seed from public.questions where author_id = tests.uid('joao') limit 1;

  perform tests.login('paula');
  insert into public.questions (subject_id, title, body)
    values (v_xadrez, 'Qual a melhor abertura para iniciantes?', 'Estou começando agora.')
    returning id into v_q;
  perform tests.eq((select author_id from public.questions where id = v_q)::text, tests.uid('paula')::text,
                   'questions: author_id = usuário logado');
  perform tests.throws(format('insert into public.questions (subject_id, title) values (%s, %L)', v_xadrez, 'Oi?'),
                       '23514', 'questions: título curto recusado');
  perform tests.throws(format('insert into public.questions (author_id, title) values (%L, %L)', tests.uid('maria'),
                       'Pergunta em nome de outra pessoa'), '42501', 'questions: não forja author_id');
  perform tests.throws(format('insert into public.questions (title, status) values (%L, %L)', 'Pergunta já escondida', 'hidden'),
                       '42501', 'questions: não define status');
  perform tests.eq(tests.affected(format('update public.questions set title = %L where id = %s',
                   'Qual a melhor abertura de xadrez para iniciantes?', v_q))::text, '1', 'questions: edita a própria');
  perform tests.throws(format('update public.questions set status = %L where id = %s', 'hidden', v_q),
                       '42501', 'questions: autor não mexe no status');
  perform tests.throws(format('update public.questions set answers_count = 99 where id = %s', v_q),
                       '42501', 'questions: não altera answers_count');
  perform tests.throws(format('insert into public.answers (question_id, body) values (%s, %L)', v_q,
                       'Resposta de aluno que não pode responder.'), '42501', 'answers: aluno não responde dúvida');

  perform tests.login('rafael');
  perform tests.eq(tests.affected(format('update public.questions set title = %L where id = %s', 'Pergunta sequestrada!!', v_q))::text,
                   '0', 'questions: não edita pergunta alheia');
  perform tests.eq(tests.affected(format('delete from public.questions where id = %s', v_q))::text, '0',
                   'questions: não apaga pergunta alheia');
  perform tests.login('maria');
  perform tests.throws(format('insert into public.answers (question_id, body) values (%s, %L)', v_seed,
                       'Outra aluna tentando responder aqui.'), '42501', 'answers: aluno não responde (seed)');

  perform tests.login('teresa');
  insert into public.answers (question_id, body) values (v_q, 'Comece pela Abertura Italiana: desenvolve as peças rápido.');
  perform tests.eq((select answers_count::text from public.questions where id = v_q), '1', 'answers: contador de respostas');
  perform tests.eq((select tutor_id from public.answers where question_id = v_q)::text, tests.uid('teresa')::text,
                   'answers: tutor_id = usuário logado');
  perform tests.throws(format('insert into public.answers (question_id, body) values (%s, %L)', v_q,
                       'Segunda resposta da mesma professora.'), '23505', 'answers: uma resposta por professor');
  perform tests.throws(format('insert into public.answers (question_id, body) values (%s, %L)', v_seed, 'curta'),
                       '23514', 'answers: resposta curta recusada');
  perform tests.throws(format('insert into public.answers (question_id, tutor_id, body) values (%s, %L, %L)', v_seed,
                       tests.uid('ana'), 'Resposta em nome da Ana, forjada.'), '42501', 'answers: não forja tutor_id');
  perform tests.throws(format('insert into public.answers (question_id, body, status) values (%s, %L, %L)', v_seed,
                       'Resposta com status definido pelo cliente.', 'published'), '42501', 'answers: não define status');
  perform tests.eq(tests.affected(format('update public.answers set body = %L where question_id = %s',
                   'Comece pela Abertura Italiana: desenvolve as peças e controla o centro.', v_q))::text, '1',
                   'answers: edita a própria');
  perform tests.throws(format('update public.answers set status = %L where question_id = %s', 'hidden', v_q),
                       '42501', 'answers: não mexe no status');

  perform tests.login('ana');
  insert into public.answers (question_id, body) values (v_q, 'Gambito da Dama também é ótimo para aprender estrutura.');
  perform tests.eq((select answers_count::text from public.questions where id = v_q), '2', 'answers: contador soma');
  perform tests.eq(tests.affected(format('update public.answers set body = %L where question_id = %s and tutor_id = %L',
                   'Resposta alheia alterada indevidamente.', v_q, tests.uid('teresa')))::text, '0',
                   'answers: não edita resposta alheia');
  perform tests.login('silvia');
  perform tests.throws(format('insert into public.answers (question_id, body) values (%s, %L)', v_q,
                       'Professora suspensa tentando responder.'), '42501', 'answers: professor suspenso não responde');
  perform tests.login('bia');
  perform tests.throws(format('insert into public.questions (subject_id, title) values (%s, %L)', v_xadrez,
                       'Pergunta de conta banida aqui'), '42501', 'questions: banido não pergunta');

  perform tests.anon();
  perform tests.eq((select count(*) from public.questions where id = v_q)::text, '1', 'questions: anon lê abertas');
  perform tests.eq((select count(*) from public.answers where question_id = v_q)::text, '2', 'answers: anon lê publicadas');
  perform tests.eq((select public.author_name(x) from public.questions x where x.id = v_q), 'Paula O.',
                   'author_name: nome abreviado');
  perform tests.throws(format('insert into public.questions (title) values (%L)', 'Pergunta anônima proibida'),
                       '42501', 'questions: anon não pergunta');
  perform tests.ok(exists (select 1 from public.search_questions('abertura') where id = v_q), 'search_questions: acha por texto');
  perform tests.eq((select author_name from public.search_questions('equacao') where id = v_seed), 'João P.',
                   'search_questions: "equacao" acha "equação" e traz author_name');
  perform tests.ok((select bool_and(subject_slug = 'matematica') and count(*) >= 1
                    from public.search_questions(p_materia => 'matematica')), 'search_questions: filtro por matéria');
  perform tests.ok((select total >= 2 from public.search_questions() limit 1), 'search_questions: total');
  -- mesmo caminho do .textSearch('search_tsv', q, { config: 'pt_unaccent', type: 'websearch' })
  perform tests.ok(exists (select 1 from public.questions
                           where search_tsv @@ websearch_to_tsquery('public.pt_unaccent', 'equacao segundo grau')),
                   'questions: textSearch com pt_unaccent');

  -- rate limit: 5 perguntas por dia
  perform tests.login('rafael');
  for i in 1..5 loop
    insert into public.questions (subject_id, title) values (v_xadrez, 'Pergunta número ' || i || ' do dia');
  end loop;
  perform tests.throws(format('insert into public.questions (subject_id, title) values (%s, %L)', v_xadrez, 'Pergunta número 6 do dia'),
                       'P0001', 'rate_limit: 6ª pergunta no dia bloqueada', '%Limite atingido%');

  perform tests.login('paula');
  insert into public.questions (title) values ('Pergunta que vou apagar logo') returning id into v_q2;
  perform tests.eq(tests.affected(format('delete from public.questions where id = %s', v_q2))::text, '1',
                   'questions: apaga a própria');
end $$;

-- =====================================================================
-- 13. pagamentos
-- =====================================================================
do $$
declare
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
  v_exp1 timestamptz;
  v_exp2 timestamptz;
begin
  perform tests.su();
  update public.tutor_profiles set plan = 'basico', plan_expires_at = null where user_id = tests.uid('teresa');

  -- a Edge Function create-checkout cria os pendentes com service_role
  perform tests.service();
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('teresa'), 'profissional', 1, public.plan_price('profissional', 1)) returning id into p1;
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('teresa'), 'profissional', 3, public.plan_price('profissional', 3)) returning id into p2;
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('teresa'), 'premium', 1, public.plan_price('premium', 1)) returning id into p3;
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('teresa'), 'premium', 1, public.plan_price('premium', 1)) returning id into p4;
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('teresa'), 'premium', 1, public.plan_price('premium', 1)) returning id into p5;
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('paula'), 'premium', 1, public.plan_price('premium', 1)) returning id into p6;
  perform tests.ok(true, 'payments: service_role cria pagamentos');
  perform tests.throws(format('insert into public.payments (user_id, plan, months, amount_cents) values (%L, %L, 1, 100)',
                       tests.uid('teresa'), 'basico'), '23514', 'payments: plano básico não é cobrado');
  perform tests.throws(format('insert into public.payments (user_id, plan, months, amount_cents) values (%L, %L, 2, 100)',
                       tests.uid('teresa'), 'premium'), '23514', 'payments: meses 1/3/12');

  perform tests.anon();
  perform tests.throws($q$select count(*) from public.payments$q$, '42501', 'payments: anon não lê');
  perform tests.throws(format('select public.apply_payment(%L, %L, %L, 2990, %L)', p1, 'mp-x', 'approved', '{}'),
                       '42501', 'apply_payment: anon não executa');

  perform tests.login('teresa');
  perform tests.eq((select count(*) from public.payments)::text, '5', 'payments: usuário lê só os próprios');
  perform tests.throws(format('insert into public.payments (user_id, plan, months, amount_cents) values (%L, %L, 1, 2990)',
                       tests.uid('teresa'), 'profissional'), '42501', 'payments: cliente não cria pagamento');
  perform tests.throws(format('update public.payments set status = %L where id = %L', 'approved', p1),
                       '42501', 'payments: cliente não aprova pagamento');
  perform tests.throws(format('delete from public.payments where id = %L', p1), '42501', 'payments: cliente não apaga');
  perform tests.throws(format('select public.apply_payment(%L, %L, %L, 2990, %L)', p1, 'mp-x', 'approved', '{}'),
                       '42501', 'apply_payment: authenticated não executa');
  perform tests.eq((select plan from public.tutor_profiles where user_id = tests.uid('teresa')), 'basico',
                   'apply_payment: negado não concede plano');
  perform tests.login('paula');
  perform tests.eq((select count(*) from public.payments where user_id = tests.uid('teresa'))::text, '0',
                   'payments: não lê pagamentos alheios');

  perform tests.service();
  perform tests.eq(public.apply_payment(p1, 'mp-1', 'approved', 2990, '{"id":1}'), 'applied', 'apply_payment: aprova');
  select plan_expires_at into v_exp1 from public.tutor_profiles where user_id = tests.uid('teresa');
  perform tests.ok((select plan = 'profissional' from public.tutor_profiles where user_id = tests.uid('teresa'))
                   and v_exp1 = now() + interval '1 month', 'apply_payment: concede plano por 1 mês');
  perform tests.eq(public.apply_payment(p1, 'mp-1', 'approved', 2990, '{"id":1}'), 'already_applied',
                   'apply_payment: idempotente');
  perform tests.ok((select plan_expires_at from public.tutor_profiles where user_id = tests.uid('teresa')) = v_exp1,
                   'apply_payment: repetição não estende a validade');
  perform tests.eq(public.apply_payment(p2, 'mp-2', 'approved', 8073, '{}'), 'applied', 'apply_payment: renovação');
  select plan_expires_at into v_exp2 from public.tutor_profiles where user_id = tests.uid('teresa');
  perform tests.ok(v_exp2 = v_exp1 + interval '3 months', 'apply_payment: renovação soma à validade atual');
  perform tests.eq(public.apply_payment(p3, 'mp-3', 'approved', 100, '{}'), 'amount_mismatch',
                   'apply_payment: valor divergente não aprova');
  perform tests.eq((select status from public.payments where id = p3), 'amount_mismatch', 'apply_payment: marca amount_mismatch');
  perform tests.eq((select plan from public.tutor_profiles where user_id = tests.uid('teresa')), 'profissional',
                   'apply_payment: valor divergente não troca o plano');
  perform tests.eq(public.apply_payment(p4, 'mp-4', 'rejected', 5990, '{}'), 'updated', 'apply_payment: recusado só atualiza');
  perform tests.eq((select status from public.payments where id = p4), 'rejected', 'apply_payment: status rejected');
  perform tests.eq(public.apply_payment(p5, 'mp-1', 'approved', 5990, '{}'), 'conflict',
                   'apply_payment: mesmo pagamento MP não quita duas referências');
  perform tests.eq(public.apply_payment(gen_random_uuid(), 'mp-9', 'approved', 5990, '{}'), 'not_found',
                   'apply_payment: referência inexistente');
  perform tests.eq(public.apply_payment(p5, 'mp-5', 'authorized', 5990, '{}'), 'ignored', 'apply_payment: status desconhecido');
  perform tests.eq(public.apply_payment(p6, 'mp-6', 'approved', 5990, '{}'), 'no_tutor', 'apply_payment: aluno sem anúncio');
  perform tests.eq(public.apply_payment(p1, 'mp-1', 'refunded', 2990, '{}'), 'reversed', 'apply_payment: estorno');
  perform tests.ok((select plan_expires_at from public.tutor_profiles where user_id = tests.uid('teresa'))
                   = v_exp2 - interval '1 month', 'apply_payment: estorno devolve os meses');
  perform tests.eq(public.apply_payment(p1, 'mp-1', 'approved', 2990, '{}'), 'ignored',
                   'apply_payment: estornado nunca é reaplicado');
end $$;

-- =====================================================================
-- 14. denúncias e moderação
-- =====================================================================
do $$
declare
  v_msg bigint;
  v_seed_msg bigint;
  v_rep bigint;
  v_rep_q bigint;
  v_review bigint;
  v_q bigint;
  v_ans bigint;
begin
  perform tests.su();
  select m.id into v_msg from public.messages m join public.conversations c on c.id = m.conversation_id
   where c.student_id = tests.uid('paula') and m.sender_id = tests.uid('teresa') limit 1;
  select id into v_seed_msg from public.messages where conversation_id = '00000000-0000-4000-b000-000000000001' limit 1;
  select id into v_review from public.reviews where student_id = tests.uid('paula') and tutor_id = tests.uid('teresa');
  select id into v_q from public.questions where author_id = tests.uid('paula') limit 1;
  select id into v_ans from public.answers where question_id = v_q and tutor_id = tests.uid('ana');

  -- denúncias
  perform tests.login('paula');
  -- sem RETURNING: a policy de SELECT de reports é só de admin (o cliente usa return=minimal)
  insert into public.reports (target_type, target_id, reason, details)
    values ('tutor', tests.uid('teresa')::text, 'contato_externo', 'Pediu WhatsApp.');
  perform tests.throws(format('insert into public.reports (target_type, target_id, reason) values (%L, %L, %L) returning id',
                       'tutor', tests.uid('ana'), 'spam'), '42501', 'reports: RETURNING não vaza denúncias (select só admin)');
  perform tests.throws(format('insert into public.reports (target_type, target_id, reason) values (%L, %L, %L)',
                       'tutor', tests.uid('teresa'), 'spam'), '23505', 'reports: não denuncia o mesmo item duas vezes');
  perform tests.throws(format('insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, %L, %L, %L)',
                       tests.uid('maria'), 'tutor', tests.uid('ana'), 'spam'), '42501', 'reports: não forja reporter_id');
  perform tests.throws(format('insert into public.reports (target_type, target_id, reason, status) values (%L, %L, %L, %L)',
                       'tutor', tests.uid('ana'), 'spam', 'resolved'), '42501', 'reports: não define status');
  perform tests.throws(format('insert into public.reports (target_type, target_id, reason) values (%L, %L, %L)',
                       'tutor', tests.uid('ana'), 'porque sim'), '23514', 'reports: motivo validado');
  insert into public.reports (target_type, target_id, reason) values ('message', v_msg::text, 'ofensivo');
  perform tests.ok(true, 'reports: denuncia mensagem da própria conversa');
  perform tests.throws(format('insert into public.reports (target_type, target_id, reason) values (%L, %L, %L)',
                       'message', v_seed_msg, 'ofensivo'), '42501', 'reports: não denuncia mensagem que não enxerga');
  perform tests.eq((select count(*) from public.reports)::text, '0', 'reports: usuário comum não lê denúncias');
  perform tests.throws($q$update public.reports set status = 'dismissed'$q$, '42501', 'reports: cliente não altera denúncia');
  perform tests.throws($q$delete from public.reports$q$, '42501', 'reports: cliente não apaga');

  perform tests.login('tiago');
  insert into public.reports (target_type, target_id, reason) values ('question', v_q::text, 'spam');
  perform tests.su();
  select id into v_rep from public.reports where reporter_id = tests.uid('paula') and target_type = 'tutor';
  select id into v_rep_q from public.reports where reporter_id = tests.uid('tiago') and target_type = 'question';
  perform tests.ok(v_rep is not null and v_rep_q is not null
                   and (select reporter_id from public.reports where id = v_rep) = tests.uid('paula'),
                   'reports: reporter_id = usuário logado');

  perform tests.login('bia');
  perform tests.throws(format('insert into public.reports (target_type, target_id, reason) values (%L, %L, %L)',
                       'tutor', tests.uid('ana'), 'spam'), '42501', 'reports: banido não denuncia');
  perform tests.anon();
  perform tests.throws(format('insert into public.reports (target_type, target_id, reason) values (%L, %L, %L)',
                       'tutor', tests.uid('ana'), 'spam'), '42501', 'reports: anon não denuncia');
  perform tests.throws($q$select count(*) from public.reports$q$, '42501', 'reports: anon não lê');

  -- rate limit: 20 denúncias por dia
  perform tests.login('rafael');
  for i in 1..20 loop
    insert into public.reports (target_type, target_id, reason) values ('review', (100000 + i)::text, 'spam');
  end loop;
  perform tests.throws($q$insert into public.reports (target_type, target_id, reason) values ('review', '999999', 'spam')$q$,
                       'P0001', 'rate_limit: 21ª denúncia no dia bloqueada', '%Limite atingido%');

  -- admin lê denúncias e só as mensagens denunciadas
  perform tests.login('admin');
  perform tests.ok((select count(*) >= 3 from public.reports), 'reports: admin lê denúncias');
  perform tests.eq((select count(*) from public.messages where id = v_msg)::text, '1', 'messages: admin lê mensagem denunciada');
  perform tests.eq((select count(*) from public.messages m join public.messages x on x.conversation_id = m.conversation_id
                    where m.id = v_msg and x.id <> v_msg)::text, '0', 'messages: admin não lê o resto da conversa');
  perform tests.eq((select count(*) from public.messages where id = v_seed_msg)::text, '0',
                   'messages: admin não lê mensagem não denunciada');

  -- admin_moderate só para admin
  perform tests.login('paula');
  perform tests.throws(format('select public.admin_moderate(%L, %L, %L)', 'tutor', tests.uid('teresa'), 'suspend'),
                       'P0001', 'admin_moderate: usuário comum recusado', '%administradores%');
  perform tests.anon();
  perform tests.throws(format('select public.admin_moderate(%L, %L, %L)', 'tutor', tests.uid('teresa'), 'suspend'),
                       '42501', 'admin_moderate: anon não executa');

  perform tests.login('admin');
  -- avaliação: ocultar some da vitrine e da média; restaurar volta
  perform public.admin_moderate('review', v_review::text, 'hide');
  perform tests.eq((select rating_count::text from public.tutor_profiles where user_id = tests.uid('teresa')), '0',
                   'moderação: avaliação oculta sai da média');
  perform tests.eq((select count(*) from public.reviews where id = v_review)::text, '1', 'reviews: admin lê oculta');
  perform tests.anon();
  perform tests.eq((select count(*) from public.reviews where id = v_review)::text, '0', 'reviews: anon não lê oculta');
  perform tests.login('paula');
  perform tests.eq((select count(*) from public.reviews where id = v_review)::text, '1', 'reviews: autor lê a própria oculta');
  perform tests.login('admin');
  perform public.admin_moderate('review', v_review::text, 'restore');
  perform tests.eq((select rating_count::text from public.tutor_profiles where user_id = tests.uid('teresa')), '1',
                   'moderação: restaurar devolve à média');

  -- pergunta: ocultar com denúncia → resolvida; ninguém responde pergunta oculta
  perform public.admin_moderate('question', v_q::text, 'hide', v_rep_q);
  perform tests.eq((select status from public.reports where id = v_rep_q), 'resolved', 'moderação: denúncia resolvida');
  perform tests.eq((select count(*) from public.questions where id = v_q)::text, '1', 'questions: admin lê oculta');
  perform tests.anon();
  perform tests.eq((select count(*) from public.questions where id = v_q)::text, '0', 'questions: anon não lê oculta');
  perform tests.login('paula');
  perform tests.eq((select count(*) from public.questions where id = v_q)::text, '1', 'questions: autor lê a própria oculta');
  perform tests.login('leo');
  perform tests.throws(format('insert into public.answers (question_id, body) values (%s, %L)', v_q,
                       'Tentando responder pergunta oculta.'), '42501', 'answers: não responde pergunta oculta');
  perform tests.login('admin');
  perform public.admin_moderate('question', v_q::text, 'restore');

  -- resposta: ocultar ajusta o contador
  perform public.admin_moderate('answer', v_ans::text, 'hide');
  perform tests.eq((select answers_count::text from public.questions where id = v_q), '1', 'moderação: resposta oculta sai do contador');
  perform tests.anon();
  perform tests.eq((select count(*) from public.answers where id = v_ans)::text, '0', 'answers: anon não lê oculta');
  perform tests.login('ana');
  perform tests.eq((select count(*) from public.answers where id = v_ans)::text, '1', 'answers: autor lê a própria oculta');
  perform tests.login('admin');
  perform tests.eq((select count(*) from public.answers where id = v_ans)::text, '1', 'answers: admin lê oculta');
  perform public.admin_moderate('answer', v_ans::text, 'restore');
  perform tests.eq((select answers_count::text from public.questions where id = v_q), '2', 'moderação: restaurar resposta');

  -- suspender professor tira da busca e do perfil público
  perform public.admin_moderate('tutor', tests.uid('teresa')::text, 'suspend');
  perform tests.anon();
  perform tests.ok(not exists (select 1 from public.search_tutors(q => 'xadrez', p_lim => 50) where slug = 'teresa-tutora'),
                   'moderação: suspenso sai da busca');
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('teresa'))::text, '0',
                   'moderação: suspenso sai do perfil público');
  perform tests.login('admin');
  perform public.admin_moderate('tutor', tests.uid('teresa')::text, 'unsuspend');
  perform tests.anon();
  perform tests.ok(exists (select 1 from public.search_tutors(q => 'xadrez', p_lim => 50) where slug = 'teresa-tutora'),
                   'moderação: reativado volta à busca');

  -- banir usuário: não envia mais; desbanir devolve
  perform tests.login('admin');
  perform public.admin_moderate('user', tests.uid('tiago')::text, 'ban');
  perform tests.login('tiago');
  perform tests.throws(format('select public.start_conversation(%L, %L)', '00000000-0000-4000-d000-000000000001', 'Oi'),
                       'P0001', 'moderação: banido não envia', '%suspensa%');
  perform tests.login('admin');
  perform public.admin_moderate('user', tests.uid('tiago')::text, 'unban');
  perform tests.login('tiago');
  perform tests.ok(public.is_active_user(), 'moderação: desbanido volta a ser ativo');

  -- banir professor tira o anúncio do ar (pelas policies/busca, sem mexer em suspended)
  perform tests.login('admin');
  perform public.admin_moderate('tutor', tests.uid('leo')::text, 'ban');
  perform tests.anon();
  perform tests.ok(not exists (select 1 from public.search_tutors(p_lim => 50) where slug = 'leo-futuro'),
                   'moderação: professor banido sai da busca');
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('leo'))::text, '0',
                   'moderação: professor banido sai do perfil público');
  perform tests.su();
  perform tests.ok((select not suspended from public.tutor_profiles where user_id = tests.uid('leo')),
                   'moderação: banir não mexe em suspended');
  perform tests.login('admin');
  perform public.admin_moderate('tutor', tests.uid('leo')::text, 'unban');
  perform tests.anon();
  perform tests.ok(exists (select 1 from public.search_tutors(p_lim => 50) where slug = 'leo-futuro'),
                   'moderação: professor desbanido volta');

  -- descartar denúncia
  perform tests.login('admin');
  perform public.admin_moderate('tutor', tests.uid('teresa')::text, 'dismiss', v_rep);
  perform tests.ok((select status = 'dismissed' and resolved_at is not null from public.reports where id = v_rep),
                   'moderação: denúncia descartada');
  perform tests.throws(format('select public.admin_moderate(%L, %L, %L)', 'tutor', tests.uid('teresa'), 'hide'),
                       'P0001', 'admin_moderate: ação inválida para o tipo');
  perform tests.throws(format('select public.admin_moderate(%L, %L, %L)', 'review', v_review, 'explodir'),
                       'P0001', 'admin_moderate: ação desconhecida');
  perform tests.throws($q$select public.admin_moderate('tutor', 'nao-e-uuid', 'suspend')$q$,
                       'P0001', 'admin_moderate: id inválido');
end $$;

-- =====================================================================
-- 15. LGPD: export_my_data
-- =====================================================================
do $$
declare
  v jsonb;
  n_msgs int;
  n_pay int;
begin
  perform tests.su();
  select count(*) into n_msgs from public.messages m join public.conversations c on c.id = m.conversation_id
   where tests.uid('paula') in (c.student_id, c.tutor_id);
  select count(*) into n_pay from public.payments where user_id = tests.uid('teresa');

  perform tests.anon();
  perform tests.throws($q$select public.export_my_data()$q$, '42501', 'export_my_data: anon não executa');

  perform tests.login('paula');
  v := public.export_my_data();
  perform tests.eq(v -> 'perfil' ->> 'id', tests.uid('paula')::text, 'export_my_data: perfil próprio');
  perform tests.eq(v -> 'conta' ->> 'email', tests.uid('paula')::text || '@teste.local', 'export_my_data: e-mail da conta');
  perform tests.ok((select bool_and(tests.uid('paula')::text in (c ->> 'student_id', c ->> 'tutor_id'))
                    from jsonb_array_elements(v -> 'conversas') c), 'export_my_data: só conversas próprias');
  perform tests.eq((select count(*) from jsonb_array_elements(v -> 'conversas') c,
                    jsonb_array_elements(c -> 'mensagens') m)::text, n_msgs::text, 'export_my_data: mensagens das conversas próprias');
  perform tests.ok(not (v::text like '%00000000-0000-4000-b000-000000000001%'), 'export_my_data: não inclui conversa alheia');
  perform tests.ok((select bool_and(r ->> 'student_id' = tests.uid('paula')::text) and count(*) = 1
                    from jsonb_array_elements(v -> 'avaliacoes_escritas') r), 'export_my_data: avaliações escritas próprias');
  perform tests.ok((select bool_and(q ->> 'author_id' = tests.uid('paula')::text) and count(*) >= 1
                    from jsonb_array_elements(v -> 'perguntas') q), 'export_my_data: perguntas próprias');
  perform tests.ok((select bool_and(r ->> 'reporter_id' = tests.uid('paula')::text) and count(*) = 2
                    from jsonb_array_elements(v -> 'denuncias') r), 'export_my_data: denúncias próprias');
  perform tests.ok((select bool_and(p ->> 'user_id' = tests.uid('paula')::text) and count(*) = 1
                    from jsonb_array_elements(v -> 'pagamentos') p), 'export_my_data: só o próprio pagamento');
  perform tests.ok(v -> 'perfil_professor' = 'null'::jsonb, 'export_my_data: aluno sem anúncio');

  perform tests.login('teresa');
  v := public.export_my_data();
  perform tests.ok((select bool_and(p ->> 'user_id' = tests.uid('teresa')::text) and count(*) = n_pay
                    from jsonb_array_elements(v -> 'pagamentos') p), 'export_my_data: pagamentos próprios');
  perform tests.ok((select bool_and(r ->> 'tutor_id' = tests.uid('teresa')::text and not (r ? 'student_id')) and count(*) >= 1
                    from jsonb_array_elements(v -> 'avaliacoes_recebidas') r),
                   'export_my_data: avaliações recebidas sem id do aluno');
  perform tests.ok((select bool_and(a ->> 'tutor_id' = tests.uid('teresa')::text) and count(*) = 1
                    from jsonb_array_elements(v -> 'respostas') a), 'export_my_data: respostas próprias');
  perform tests.ok(v -> 'perfil_professor' ->> 'slug' = 'teresa-tutora' and not (v -> 'perfil_professor' ? 'search_tsv'),
                   'export_my_data: anúncio próprio');
end $$;

-- =====================================================================
-- 16. Exclusão de conta (delete-account apaga auth.users → cascata)
-- =====================================================================
do $$
declare
  v_pay int;
begin
  perform tests.su();
  select count(*) into v_pay from public.payments where user_id in (tests.uid('teresa'), tests.uid('paula'));
  perform tests.ok(exists (select 1 from public.rate_events where actor = tests.uid('paula')),
                   'rate_events: ações da Paula registradas (antes da exclusão)');
  delete from auth.users where id = tests.uid('paula');
  perform tests.ok(not exists (select 1 from public.profiles where id = tests.uid('paula')), 'exclusão: perfil removido');
  perform tests.ok(not exists (select 1 from public.conversations where student_id = tests.uid('paula')),
                   'exclusão: conversas removidas');
  perform tests.eq((select rating_count::text from public.tutor_profiles where user_id = tests.uid('teresa')), '0',
                   'exclusão: avaliação removida recalcula a nota');
  perform tests.ok(exists (select 1 from public.reports where reporter_id is null and target_id = tests.uid('teresa')::text),
                   'exclusão: denúncia fica anônima');
  perform tests.ok(not exists (select 1 from public.rate_events where actor = tests.uid('paula')),
                   'exclusão: registro do rate limit removido');

  delete from auth.users where id = tests.uid('teresa');
  perform tests.ok(not exists (select 1 from public.tutor_profiles where user_id = tests.uid('teresa')),
                   'exclusão: anúncio do professor removido');
  perform tests.eq((select count(*) from public.payments where user_id is null)::text, v_pay::text,
                   'exclusão: pagamentos ficam sem usuário (registro fiscal)');
  perform tests.ok(not exists (select 1 from public.answers where tutor_id = tests.uid('teresa')), 'exclusão: respostas removidas');
end $$;

-- =====================================================================
-- 17. Regressões da revisão de segurança
-- =====================================================================
-- 17a. rate limit conta um registro só de inserção: apagar e repostar não zera
do $$
declare
  v_xadrez smallint := (select id from public.subjects where slug = 'xadrez');
begin
  perform tests.new_user(tests.uid('vitor'), 'Vitor Veloz');
  perform tests.login('vitor');
  for i in 1..5 loop
    insert into public.questions (subject_id, title) values (v_xadrez, 'Pergunta repetida número ' || i);
  end loop;
  perform tests.eq(tests.affected('delete from public.questions where author_id = auth.uid()')::text, '5',
                   'rate_limit: autor apaga as próprias perguntas');
  perform tests.throws(format('insert into public.questions (subject_id, title) values (%s, %L)', v_xadrez,
                       'Repostando depois de apagar'), 'P0001',
                       'rate_limit: apagar e repostar não zera o limite de perguntas', '%Limite atingido%');
  perform tests.throws('select count(*) from public.rate_events', '42501', 'rate_events: cliente não lê');
  perform tests.throws(format('insert into public.rate_events (actor, tbl) values (%L, %L)', tests.uid('vitor'), 'x'),
                       '42501', 'rate_events: cliente não grava');
  perform tests.throws('delete from public.rate_events', '42501', 'rate_events: cliente não zera o próprio limite');
  perform tests.anon();
  perform tests.throws('select count(*) from public.rate_events', '42501', 'rate_events: anon não lê');

  -- eventos fora da janela são podados na próxima inserção
  perform tests.su();
  update public.rate_events set created_at = now() - interval '2 days'
   where actor = tests.uid('vitor') and tbl = 'questions';
  perform tests.login('vitor');
  insert into public.questions (subject_id, title) values (v_xadrez, 'Pergunta de um novo dia');
  perform tests.su();
  perform tests.eq((select count(*) from public.rate_events where actor = tests.uid('vitor') and tbl = 'questions')::text,
                   '1', 'rate_limit: eventos fora da janela são podados');
end $$;

-- 17b. requisições paralelas não furam os limites (conexões reais via dblink)
do $$
begin
  perform tests.new_user(tests.uid('xavier'), 'Xavier Paralelo');
end $$;

do $$
declare
  v_sqls text[];
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    raise warning 'PULADO: dblink indisponível, testes de concorrência não rodaram';
    return;
  end if;
  select array_agg(format('insert into public.questions (title) values (%L)', 'Pergunta paralela número ' || i))
    into v_sqls from generate_series(1, 12) i;
  perform tests.eq(tests.race('xavier', v_sqls)::text, '5', 'rate_limit: 12 perguntas em paralelo, só 5 passam');
  perform tests.eq((select count(*) from public.questions where author_id = tests.uid('xavier'))::text, '5',
                   'rate_limit: em paralelo grava no máximo 5 perguntas');

  -- 13 contatos novos ao mesmo tempo (11 extras + Ana + Bruno): só 10 passam
  select array_agg(format('select public.start_conversation(%L, %L)', t, 'Oi! Tem horário esta semana?'))
    into v_sqls
    from unnest(array(select ('00000000-0000-4000-d000-0000000000' || lpad(i::text, 2, '0'))::uuid
                      from generate_series(1, 11) i) || array[tests.uid('ana'), tests.uid('bruno')]) t;
  perform tests.eq(tests.race('xavier', v_sqls)::text, '10', 'start_conversation: 13 contatos em paralelo, só 10 passam');
  perform tests.eq((select count(*) from public.conversations where student_id = tests.uid('xavier'))::text, '10',
                   'start_conversation: em paralelo abre no máximo 10 conversas');

  -- várias abas abrindo a mesma conversa: uma conversa só, todas as mensagens
  select array_agg(format('select public.start_conversation(%L, %L)', tests.uid('carla'), 'Mensagem paralela ' || i))
    into v_sqls from generate_series(1, 4) i;
  perform tests.eq(tests.race('vitor', v_sqls)::text, '4', 'start_conversation: pedidos paralelos ao mesmo professor passam');
  perform tests.eq((select count(*)::text || '/' || sum((select count(*) from public.messages m where m.conversation_id = c.id))
                    from public.conversations c
                    where c.student_id = tests.uid('vitor') and c.tutor_id = tests.uid('carla')), '1/4',
                   'start_conversation: paralelos reaproveitam uma conversa com as 4 mensagens');
end $$;

-- 17c. conteúdo oculto pelo admin fica travado para o autor (não apaga para repostar)
do $$
declare
  v_review bigint;
  v_seed_q bigint;
  v_ans bigint;
begin
  perform tests.su();
  select id into v_review from public.reviews where student_id = tests.uid('maria') and tutor_id = tests.uid('ana');
  select id into v_seed_q from public.questions where author_id = tests.uid('joao') order by id limit 1;
  select id into v_ans from public.answers where question_id = v_seed_q and tutor_id = tests.uid('gabriela');

  perform tests.login('admin');
  perform public.admin_moderate('review', v_review::text, 'hide');
  perform public.admin_moderate('answer', v_ans::text, 'hide');

  perform tests.login('maria');
  perform tests.eq(tests.affected(format('delete from public.reviews where id = %s', v_review))::text, '0',
                   'moderação: autor não apaga avaliação oculta');
  perform tests.eq(tests.affected(format('update public.reviews set comment = %L where id = %s', 'editada', v_review))::text,
                   '0', 'moderação: autor não edita avaliação oculta');
  perform tests.throws(format('insert into public.reviews (tutor_id, rating, comment) values (%L, 1, %L)',
                       tests.uid('ana'), 'CONTEUDO QUE O ADMIN ESCONDEU'), '23505',
                       'moderação: avaliação oculta não volta como publicada');
  perform tests.eq((select rating_count::text from public.tutor_profiles where user_id = tests.uid('ana')), '0',
                   'moderação: avaliação oculta segue fora da média');

  perform tests.login('gabriela');
  perform tests.eq(tests.affected(format('delete from public.answers where id = %s', v_ans))::text, '0',
                   'moderação: professor não apaga resposta oculta');
  perform tests.eq(tests.affected(format('update public.answers set body = %L where id = %s',
                   'Resposta editada depois de ocultada pelo admin.', v_ans))::text, '0',
                   'moderação: professor não edita resposta oculta');
  perform tests.throws(format('insert into public.answers (question_id, body) values (%s, %L)', v_seed_q,
                       'SPAM QUE O ADMIN ESCONDEU, chama no zap'), '23505',
                       'moderação: resposta oculta não volta como publicada');

  -- pergunta oculta: autor não apaga nem edita; as respostas saem do público
  perform tests.login('admin');
  perform public.admin_moderate('answer', v_ans::text, 'restore');
  perform public.admin_moderate('question', v_seed_q::text, 'hide');
  perform tests.login('joao');
  perform tests.eq(tests.affected(format('delete from public.questions where id = %s', v_seed_q))::text, '0',
                   'moderação: autor não apaga pergunta oculta');
  perform tests.eq(tests.affected(format('update public.questions set title = %L where id = %s',
                   'Título trocado depois de ocultada', v_seed_q))::text, '0', 'moderação: autor não edita pergunta oculta');
  perform tests.anon();
  perform tests.eq((select count(*) from public.answers where question_id = v_seed_q)::text, '0',
                   'answers: resposta de pergunta oculta sai do público');
  perform tests.login('gabriela');
  perform tests.eq((select count(*) from public.answers where question_id = v_seed_q)::text, '1',
                   'answers: professor ainda vê a própria resposta de pergunta oculta');
  perform tests.login('admin');
  perform tests.eq((select count(*) from public.answers where question_id = v_seed_q)::text, '1',
                   'answers: admin vê resposta de pergunta oculta');

  perform public.admin_moderate('question', v_seed_q::text, 'restore');
  perform public.admin_moderate('review', v_review::text, 'restore');
  perform tests.anon();
  perform tests.eq((select count(*) from public.answers where question_id = v_seed_q)::text, '1',
                   'answers: pergunta restaurada devolve a resposta');
  perform tests.login('maria');
  perform tests.eq(tests.affected(format('update public.reviews set comment = %L where id = %s',
                   'Explica com muita calma. Recomendo!', v_review))::text, '1',
                   'reviews: autor ainda edita a própria publicada');
end $$;

-- 17d. banido não edita nada; o anúncio sai do ar sem mexer em suspended
do $$
declare
  v_seed_q bigint;
begin
  perform tests.su();
  select id into v_seed_q from public.questions where author_id = tests.uid('joao') order by id limit 1;
  -- plano pago: o limite de matérias não mascara a checagem de RLS
  update public.tutor_profiles set plan = 'profissional', plan_expires_at = now() + interval '30 days'
   where user_id = tests.uid('gabriela');
  perform tests.login('admin');
  perform public.admin_moderate('user', tests.uid('maria')::text, 'ban');
  perform public.admin_moderate('user', tests.uid('joao')::text, 'ban');
  perform public.admin_moderate('user', tests.uid('gabriela')::text, 'ban');

  perform tests.login('maria');
  perform tests.eq(tests.affected($q$update public.reviews set rating = 1, comment = 'ABUSO EDITADO APOS BAN'
                                     where student_id = auth.uid()$q$)::text, '0', 'banido: não edita avaliação');
  perform tests.eq((select rating_avg::text from public.tutor_profiles where user_id = tests.uid('ana')), '5.00',
                   'banido: nota do professor não muda');
  perform tests.eq(tests.affected($q$update public.profiles set full_name = 'Xingamento Ofensivo'
                                     where id = auth.uid()$q$)::text, '0', 'banido: não troca o nome público');
  perform tests.eq(tests.affected(format('update public.profiles set avatar_path = %L where id = auth.uid()',
                   tests.uid('maria')::text || '/avatar-2.webp'))::text, '0', 'banido: não troca a foto');
  perform tests.throws(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'avatars',
                       tests.uid('maria')::text || '/avatar-9.webp'), '42501', 'banido: não sobe arquivo de foto');

  perform tests.login('joao');
  perform tests.eq(tests.affected($q$update public.questions set title = 'SPAM EDITADO APOS BAN compre agora'
                                     where author_id = auth.uid()$q$)::text, '0', 'banido: não edita pergunta');

  perform tests.login('gabriela');
  perform tests.eq(tests.affected($q$update public.answers set body = 'SPAM EDITADO APOS BAN, chama no zap agora'
                                     where tutor_id = auth.uid()$q$)::text, '0', 'banido: não edita resposta');
  perform tests.eq(tests.affected($q$update public.tutor_profiles set headline = 'Anúncio editado após ban'
                                     where user_id = auth.uid()$q$)::text, '0', 'banido: não edita o anúncio');
  perform tests.throws(format('insert into public.tutor_subjects (tutor_id, subject_id) select %L, id from public.subjects where slug = %L',
                       tests.uid('gabriela'), 'fisica'), '42501', 'banido: não adiciona matéria');
  perform tests.eq(tests.affected($q$update public.tutor_subjects set levels = '{medio}' where tutor_id = auth.uid()$q$)::text,
                   '0', 'banido: não altera níveis');
  perform tests.eq(tests.affected('delete from public.tutor_subjects where tutor_id = auth.uid()')::text, '0',
                   'banido: não remove matéria');

  perform tests.anon();
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('gabriela'))::text, '0',
                   'banido: anúncio sai do perfil público');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('gabriela'))::text, '0',
                   'banido: perfil sai do público');
  perform tests.eq((select count(*) from public.tutor_subjects where tutor_id = tests.uid('gabriela'))::text, '0',
                   'banido: matérias saem do público');
  perform tests.ok(not exists (select 1 from public.search_tutors(p_lim => 50) where slug = 'gabriela-nunes'),
                   'banido: sai da busca');
  perform tests.su();
  perform tests.ok((select not suspended from public.tutor_profiles where user_id = tests.uid('gabriela')),
                   'banido: suspended intacto');

  -- professor suspenso também não edita a resposta
  perform tests.login('admin');
  perform public.admin_moderate('user', tests.uid('maria')::text, 'unban');
  perform public.admin_moderate('user', tests.uid('joao')::text, 'unban');
  perform public.admin_moderate('user', tests.uid('gabriela')::text, 'unban');
  perform public.admin_moderate('tutor', tests.uid('gabriela')::text, 'suspend');
  perform tests.login('gabriela');
  perform tests.eq(tests.affected($q$update public.answers set body = 'Resposta editada com o anúncio suspenso.'
                                     where tutor_id = auth.uid()$q$)::text, '0', 'suspenso: não edita resposta');
  perform tests.login('admin');
  perform public.admin_moderate('tutor', tests.uid('gabriela')::text, 'unsuspend');
  perform tests.login('gabriela');
  perform tests.eq(tests.affected($q$update public.answers set body = 'Use soma e produto quando a = 1: dois números com soma -b e produto c.'
                                     where tutor_id = auth.uid()$q$)::text, '1', 'reativado: volta a editar a resposta');
  perform tests.login('maria');
  perform tests.eq(tests.affected($q$update public.profiles set full_name = 'Maria Santos' where id = auth.uid()$q$)::text,
                   '1', 'desbanido: volta a editar o perfil');
  perform tests.anon();
  perform tests.ok(exists (select 1 from public.search_tutors(p_lim => 50) where slug = 'gabriela-nunes'),
                   'desbanido: volta à busca');
  perform tests.eq((select count(*) from public.questions where id = v_seed_q)::text, '1',
                   'desbanido: pergunta continua no ar');
  perform tests.su();
  update public.tutor_profiles set plan = 'basico', plan_expires_at = null where user_id = tests.uid('gabriela');
end $$;

-- 17e. desbanir não desfaz uma suspensão à parte
do $$
begin
  perform tests.login('admin');
  perform public.admin_moderate('tutor', tests.uid('carla')::text, 'suspend');
  perform public.admin_moderate('user', tests.uid('carla')::text, 'ban');
  perform public.admin_moderate('user', tests.uid('carla')::text, 'unban');
  perform tests.su();
  perform tests.ok((select suspended from public.tutor_profiles where user_id = tests.uid('carla')),
                   'moderação: desbanir mantém a suspensão do anúncio');
  perform tests.anon();
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('carla'))::text, '0',
                   'moderação: suspenso e desbanido segue fora do ar');
  perform tests.login('admin');
  perform public.admin_moderate('tutor', tests.uid('carla')::text, 'unsuspend');
  perform tests.anon();
  perform tests.eq((select count(*) from public.tutor_profiles where user_id = tests.uid('carla'))::text, '1',
                   'moderação: reativar explicitamente devolve o anúncio');
end $$;

-- 17f. público só enxerga professores com anúncio no ar
do $$
begin
  perform tests.anon();
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('otavio'))::text, '0',
                   'profiles: anon não lê professor despublicado');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('silvia'))::text, '0',
                   'profiles: anon não lê professor suspenso');
  perform tests.eq((select count(*) from public.profiles p
                    where not exists (select 1 from public.tutor_profiles t where t.user_id = p.id))::text, '0',
                   'profiles: anon não enumera cadastros sem anúncio no ar');
  perform tests.eq((select count(*) from public.tutor_subjects where tutor_id in (tests.uid('otavio'), tests.uid('silvia')))::text,
                   '0', 'tutor_subjects: anon não lê matérias de anúncio fora do ar');
  perform tests.login('rafael');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('otavio'))::text, '0',
                   'profiles: logado não lê professor despublicado');
  perform tests.login('otavio');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('otavio'))::text
                   || '/' || (select count(*) from public.tutor_subjects where tutor_id = tests.uid('otavio')),
                   '1/1', 'profiles/tutor_subjects: dono lê os próprios fora do ar');
  perform tests.login('admin');
  perform tests.eq((select count(*) from public.tutor_subjects where tutor_id = tests.uid('otavio'))::text, '1',
                   'tutor_subjects: admin lê matérias de anúncio fora do ar');

  -- quem conversa com o professor continua vendo o nome dele se o anúncio for suspenso
  perform public.admin_moderate('tutor', tests.uid('extra1')::text, 'suspend');
  perform tests.login('tiago');
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('extra1'))::text, '1',
                   'profiles: aluno ainda vê o professor suspenso com quem conversa');
  perform tests.anon();
  perform tests.eq((select count(*) from public.profiles where id = tests.uid('extra1'))::text, '0',
                   'profiles: anon não vê o professor suspenso');
  perform tests.login('admin');
  perform public.admin_moderate('tutor', tests.uid('extra1')::text, 'unsuspend');
end $$;

-- 17g. avatar_path só no formato do upload (sem "..", sem subpasta)
do $$
declare
  v_me text := tests.uid('rafael')::text;
begin
  perform tests.login('rafael');
  perform tests.throws(format('update public.profiles set avatar_path = %L where id = auth.uid()',
                       v_me || '/../../outro-bucket/arquivo.png'), '23514', 'avatar_path: ".." recusado');
  perform tests.throws(format('update public.profiles set avatar_path = %L where id = auth.uid()',
                       v_me || '/../' || tests.uid('ana')::text || '/avatar.webp'), '23514', 'avatar_path: pasta alheia via ".." recusada');
  perform tests.throws(format('update public.profiles set avatar_path = %L where id = auth.uid()',
                       v_me || '/sub/avatar.webp'), '23514', 'avatar_path: subpasta recusada');
  perform tests.throws(format('update public.profiles set avatar_path = %L where id = auth.uid()',
                       v_me || '/avatar.svg'), '23514', 'avatar_path: extensão fora da lista recusada');
  perform tests.eq(tests.affected(format('update public.profiles set avatar_path = %L where id = auth.uid()',
                   v_me || '/avatar-1727222400000.webp'))::text, '1', 'avatar_path: formato do upload aceito');
end $$;

-- 17h. apply_payment: checkout antigo de plano inferior e estorno de outra tentativa
do $$
declare
  pa uuid; pb uuid; pc uuid; pd uuid;
  v_exp timestamptz;
begin
  perform tests.su();
  update public.tutor_profiles set plan = 'basico', plan_expires_at = null
   where user_id in (tests.uid('carla'), tests.uid('eduarda'));
  perform tests.service();
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('carla'), 'profissional', 1, public.plan_price('profissional', 1)) returning id into pa;
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('carla'), 'premium', 12, public.plan_price('premium', 12)) returning id into pb;
  perform tests.eq(public.apply_payment(pb, 'mp-pb', 'approved', 53910, '{}'), 'applied', 'apply_payment: premium 12 meses');
  select plan_expires_at into v_exp from public.tutor_profiles where user_id = tests.uid('carla');
  perform tests.eq(public.apply_payment(pa, 'mp-pa', 'approved', 2990, '{}'), 'superseded',
                   'apply_payment: checkout antigo de plano inferior não rebaixa (superseded)');
  perform tests.ok((select plan = 'premium' and plan_expires_at = v_exp from public.tutor_profiles
                    where user_id = tests.uid('carla')), 'apply_payment: superseded preserva plano e validade');
  perform tests.ok((select status = 'approved' and applied_at is null from public.payments where id = pa),
                   'apply_payment: superseded fica pago e não aplicado');
  perform tests.eq(public.apply_payment(pa, 'mp-pa', 'approved', 2990, '{}'), 'already_applied',
                   'apply_payment: superseded é idempotente');
  perform tests.eq(public.apply_payment(pa, 'mp-pa', 'refunded', 2990, '{}'), 'updated',
                   'apply_payment: estorno de superseded só registra');
  perform tests.ok((select plan = 'premium' and plan_expires_at = v_exp from public.tutor_profiles
                    where user_id = tests.uid('carla')), 'apply_payment: estorno de superseded não mexe no plano');

  -- upgrade (profissional vigente -> premium) continua valendo
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('eduarda'), 'profissional', 1, public.plan_price('profissional', 1)) returning id into pc;
  insert into public.payments (user_id, plan, months, amount_cents)
    values (tests.uid('eduarda'), 'premium', 1, public.plan_price('premium', 1)) returning id into pd;
  perform tests.eq(public.apply_payment(pc, '111', 'pending', 2990, '{}'), 'updated', 'apply_payment: Pix pendente');
  perform tests.eq(public.apply_payment(pc, '222', 'approved', 2990, '{}'), 'applied', 'apply_payment: cartão aprovado na mesma referência');
  perform tests.eq(public.apply_payment(pd, 'mp-pd', 'approved', 5990, '{}'), 'applied', 'apply_payment: upgrade para plano superior');
  perform tests.eq((select plan from public.tutor_profiles where user_id = tests.uid('eduarda')), 'premium',
                   'apply_payment: upgrade troca o plano');
  select plan_expires_at into v_exp from public.tutor_profiles where user_id = tests.uid('eduarda');

  -- Pix abandonado expira depois do cartão aprovado: não desfaz nada
  perform tests.eq(public.apply_payment(pc, '111', 'cancelled', 2990, '{}'), 'already_applied',
                   'apply_payment: cancelamento de outra tentativa não desfaz o pagamento');
  perform tests.eq(public.apply_payment(pc, '333', 'refunded', 2990, '{}'), 'already_applied',
                   'apply_payment: estorno de outro pagamento do MP não desfaz');
  perform tests.ok((select status = 'approved' and mp_payment_id = '222' from public.payments where id = pc),
                   'apply_payment: referência segue quitada pelo pagamento 222');
  perform tests.eq(public.apply_payment(pc, '222', 'refunded', 2990, '{}'), 'reversed',
                   'apply_payment: estorno do pagamento que quitou desfaz');
  perform tests.ok((select plan = 'premium' and plan_expires_at = v_exp from public.tutor_profiles
                    where user_id = tests.uid('eduarda')), 'apply_payment: estorno do profissional não mexe no premium');
end $$;

-- 17i. anúncio publicado não pode ser esvaziado
do $$
begin
  perform tests.login('extra2');
  perform tests.throws($q$update public.tutor_profiles set headline = '' where user_id = auth.uid()$q$,
                       'P0001', 'publicado: não esvazia o título', '%despublique%');
  perform tests.throws($q$update public.tutor_profiles set hourly_rate_cents = null where user_id = auth.uid()$q$,
                       'P0001', 'publicado: não apaga o preço', '%hora-aula%');
  perform tests.throws($q$update public.tutor_profiles set mode_online = false, mode_presencial = false
                          where user_id = auth.uid()$q$, 'P0001', 'publicado: não fica sem modalidade', '%online%');
  perform tests.throws($q$update public.tutor_profiles set mode_presencial = true where user_id = auth.uid()$q$,
                       'P0001', 'publicado: presencial exige cidade depois de publicar', '%cidade%');
  perform tests.throws('delete from public.tutor_subjects where tutor_id = auth.uid()',
                       'P0001', 'publicado: não remove a última matéria', '%matéria%');
  perform tests.anon();
  perform tests.ok((select headline <> '' and hourly_rate_cents is not null and cardinality(subjects) = 1
                    from public.search_tutors(p_lim => 50) where slug = 'extra-tutor-2'),
                   'publicado: anúncio segue completo na busca');
  perform tests.login('extra2');
  perform tests.eq(tests.affected('update public.tutor_profiles set published = false where user_id = auth.uid()')::text,
                   '1', 'despublicar: sempre permitido');
  perform tests.eq(tests.affected('delete from public.tutor_subjects where tutor_id = auth.uid()')::text, '1',
                   'despublicado: pode remover a última matéria');
  perform tests.eq(tests.affected($q$update public.tutor_profiles set headline = '' where user_id = auth.uid()$q$)::text,
                   '1', 'despublicado: pode esvaziar o anúncio');
end $$;

-- 17j. matérias: contrato de upsert do cliente
do $$
begin
  perform tests.login('extra3');
  insert into public.tutor_subjects (tutor_id, subject_id)
    select auth.uid(), id from public.subjects where slug in ('fisica', 'quimica');
  perform tests.eq(tests.affected($q$insert into public.tutor_subjects (tutor_id, subject_id)
                   select auth.uid(), id from public.subjects where slug = 'xadrez'
                   on conflict (tutor_id, subject_id) do nothing$q$)::text, '0',
                   'limite: upsert com ignoreDuplicates de matéria existente passa no limite');
  perform tests.throws($q$insert into public.tutor_subjects (tutor_id, subject_id, levels)
                   select auth.uid(), id, '{adulto}' from public.subjects where slug = 'xadrez'
                   on conflict (tutor_id, subject_id) do update
                   set tutor_id = excluded.tutor_id, subject_id = excluded.subject_id, levels = excluded.levels$q$,
                   '42501', 'tutor_subjects: upsert com merge é negado (cliente usa insert + update de levels)');
  perform tests.eq(tests.affected($q$update public.tutor_subjects set levels = '{adulto}' where tutor_id = auth.uid()$q$)::text,
                   '3', 'tutor_subjects: update de levels continua liberado');
end $$;

-- 17k. conta anterior à migração funciona normalmente
do $$
begin
  perform tests.login('antiga');
  perform tests.ok(public.is_active_user(), 'backfill: conta antiga é usuário ativo');
  perform tests.eq(public.become_tutor(), 'conta-antiga', 'backfill: conta antiga vira professora');
end $$;

-- ---------- Resumo ----------
do $$
begin
  raise notice '== % asserções OK ==', (select last_value from tests.passed);
end $$;
