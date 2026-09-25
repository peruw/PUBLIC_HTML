-- =====================================================================
-- Portal /professores/ — 003 mensagens internas
-- Uma conversa por par aluno→professor. Conversas só nascem pela RPC
-- start_conversation (limite de contatos novos/dia); mensagens seguintes
-- são inseridas direto (RLS: só participantes ativos).
-- =====================================================================

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles (user_id) on delete cascade,
  subject_id smallint references public.subjects (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  student_last_read_at timestamptz not null default now(),
  tutor_last_read_at timestamptz not null default 'epoch',
  student_notified_at timestamptz,
  tutor_notified_at timestamptz,
  unique (student_id, tutor_id),
  check (student_id <> tutor_id)
);
create index if not exists conversations_tutor_idx on public.conversations (tutor_id, last_message_at desc);
create index if not exists conversations_student_idx on public.conversations (student_id, last_message_at desc);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, id);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at);

-- Realtime (postgres_changes respeita o RLS de messages)
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_catalog.pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------- Helpers de policy ----------
create or replace function public.is_participant(p_conv uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv and (select auth.uid()) in (c.student_id, c.tutor_id)
  )
$$;

create or replace function public.shares_conversation(p_other uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where (c.student_id = (select auth.uid()) and c.tutor_id = p_other)
       or (c.tutor_id = (select auth.uid()) and c.student_id = p_other)
  )
$$;

-- ---------- Triggers ----------
-- Atualiza a conversa e marca como lida para quem enviou.
create or replace function public.after_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.conversations c set
    last_message_at = greatest(c.last_message_at, new.created_at),
    student_last_read_at = case when c.student_id = new.sender_id
                                then greatest(c.student_last_read_at, new.created_at) else c.student_last_read_at end,
    tutor_last_read_at = case when c.tutor_id = new.sender_id
                              then greatest(c.tutor_last_read_at, new.created_at) else c.tutor_last_read_at end
  where c.id = new.conversation_id;

  -- "ativo recentemente" do professor (no máximo 1 escrita por hora)
  update public.tutor_profiles tp set last_active_at = now()
  where tp.user_id = new.sender_id
    and (tp.last_active_at is null or tp.last_active_at < now() - interval '1 hour');
  return null;
end $$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.rate_limit('sender_id', '10 minutes', '60');

drop trigger if exists after_message on public.messages;
create trigger after_message after insert on public.messages
  for each row execute function public.after_message();

-- ---------- RPCs ----------
-- Abre (ou reaproveita) a conversa com o professor e envia a primeira mensagem.
create or replace function public.start_conversation(p_tutor uuid, p_body text, p_subject smallint default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_conv uuid;
  v_new int;
begin
  if v_uid is null then
    raise exception 'Faça login para enviar mensagens.' using errcode = 'P0001';
  end if;
  if not public.is_active_user() then
    raise exception 'Sua conta está suspensa.' using errcode = 'P0001';
  end if;
  if p_tutor = v_uid then
    raise exception 'Você não pode enviar mensagem para si mesmo.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.tutor_profiles tp join public.profiles pr on pr.id = tp.user_id
    where tp.user_id = p_tutor and tp.published and not tp.suspended and pr.banned_at is null
  ) then
    raise exception 'Professor não encontrado.' using errcode = 'P0001';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'Escreva uma mensagem de até 4000 caracteres.' using errcode = 'P0001';
  end if;
  if p_subject is not null and not exists (select 1 from public.subjects s where s.id = p_subject) then
    raise exception 'Matéria inválida.' using errcode = 'P0001';
  end if;

  select c.id into v_conv from public.conversations c where c.student_id = v_uid and c.tutor_id = p_tutor;
  if v_conv is null then
    -- serializa por aluno: chamadas paralelas não furam o limite diário.
    -- Depois do lock a contagem tem snapshot novo; relê a conversa (pode ter sido criada em paralelo).
    perform pg_advisory_xact_lock(hashtextextended('start_conversation:' || v_uid::text, 0));
    select c.id into v_conv from public.conversations c where c.student_id = v_uid and c.tutor_id = p_tutor;
  end if;
  if v_conv is null then
    select count(*) into v_new from public.conversations c
      where c.student_id = v_uid and c.created_at > now() - interval '1 day';
    if v_new >= 10 then
      raise exception 'Você atingiu o limite de 10 novos contatos por dia. Tente amanhã.' using errcode = 'P0001';
    end if;
    insert into public.conversations (student_id, tutor_id, subject_id)
      values (v_uid, p_tutor, p_subject)
      on conflict (student_id, tutor_id) do nothing
      returning id into v_conv;
    if v_conv is null then
      select c.id into v_conv from public.conversations c where c.student_id = v_uid and c.tutor_id = p_tutor;
    end if;
  end if;

  insert into public.messages (conversation_id, sender_id, body) values (v_conv, v_uid, v_body);
  return v_conv;
end $$;

create or replace function public.mark_read(p_conv uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.conversations c set
    student_last_read_at = case when c.student_id = (select auth.uid())
                                then greatest(clock_timestamp(), c.last_message_at) else c.student_last_read_at end,
    tutor_last_read_at = case when c.tutor_id = (select auth.uid())
                              then greatest(clock_timestamp(), c.last_message_at) else c.tutor_last_read_at end
  where c.id = p_conv and (select auth.uid()) in (c.student_id, c.tutor_id)
$$;

-- Nº de conversas com mensagem não lida (badge do menu).
create or replace function public.unread_count() returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.conversations c
  where (c.student_id = (select auth.uid()) and c.last_message_at > c.student_last_read_at)
     or (c.tutor_id = (select auth.uid()) and c.last_message_at > c.tutor_last_read_at)
$$;

create or replace function public.list_conversations()
returns table (
  id uuid, other_id uuid, other_name text, other_avatar text, other_slug text, i_am text,
  last_message_at timestamptz, last_body text, unread boolean)
language sql stable security definer set search_path = ''
as $$
  with me as (select auth.uid() as uid)
  select c.id,
         o.id,
         o.full_name,
         o.avatar_path,
         case when c.student_id = me.uid then tp.slug end,
         case when c.student_id = me.uid then 'student' else 'tutor' end,
         c.last_message_at,
         (select left(m.body, 120) from public.messages m
           where m.conversation_id = c.id order by m.id desc limit 1),
         case when c.student_id = me.uid then c.last_message_at > c.student_last_read_at
              else c.last_message_at > c.tutor_last_read_at end
  from me
  join public.conversations c on me.uid in (c.student_id, c.tutor_id)
  join public.profiles o on o.id = case when c.student_id = me.uid then c.tutor_id else c.student_id end
  left join public.tutor_profiles tp on tp.user_id = c.tutor_id
  order by c.last_message_at desc
$$;

-- ---------- RLS ----------
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using ((select auth.uid()) in (student_id, tutor_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_participant(conversation_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid())
              and public.is_participant(conversation_id)
              and (select public.is_active_user()));

-- Quem conversa vê o perfil do outro (inclusive de aluno)
drop policy if exists profiles_read_counterpart on public.profiles;
create policy profiles_read_counterpart on public.profiles for select to authenticated
  using (public.shares_conversation(id));

-- ---------- Grants ----------
revoke all on table public.conversations, public.messages from anon, authenticated;
grant select on table public.conversations to authenticated;
grant select, insert (conversation_id, body) on table public.messages to authenticated;

revoke execute on function public.after_message() from public, anon, authenticated;
revoke execute on function public.is_participant(uuid), public.shares_conversation(uuid),
  public.start_conversation(uuid, text, smallint), public.mark_read(uuid), public.unread_count(),
  public.list_conversations()
  from public, anon, authenticated;
grant execute on function public.is_participant(uuid), public.shares_conversation(uuid),
  public.start_conversation(uuid, text, smallint), public.mark_read(uuid), public.unread_count(),
  public.list_conversations()
  to authenticated;
