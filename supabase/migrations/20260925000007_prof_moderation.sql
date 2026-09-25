-- =====================================================================
-- Portal /professores/ — 007 moderação e LGPD
-- Denúncias, ações de admin (admin_moderate) e exportação de dados.
--
-- Admin inicial (manual, no SQL Editor do Supabase):
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'voce@exemplo.com');
-- =====================================================================

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid default auth.uid() references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('tutor', 'review', 'question', 'answer', 'message')),
  target_id text not null check (char_length(target_id) between 1 and 64),
  reason text not null check (reason in ('spam', 'ofensivo', 'falso', 'contato_externo', 'menor_de_idade', 'outro')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (reporter_id, target_type, target_id)
);
create index if not exists reports_open_idx on public.reports (created_at desc) where status = 'open';
create index if not exists reports_target_idx on public.reports (target_type, target_id);

drop trigger if exists reports_rate_limit on public.reports;
create trigger reports_rate_limit before insert on public.reports
  for each row execute function public.rate_limit('reporter_id', '1 day', '20');

-- Mensagem só pode ser denunciada por quem participa da conversa.
-- (definer: ler messages direto na policy de reports gera recursão de RLS
--  com a policy de admin de messages, que lê reports)
create or replace function public.can_report_message(p_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when p_id ~ '^[0-9]{1,18}$' then exists (
    select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
    where m.id = p_id::bigint and (select auth.uid()) in (c.student_id, c.tutor_id))
  else false end
$$;

-- ---------- RLS ----------
alter table public.reports enable row level security;

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (select public.is_active_user())
    and (target_type <> 'message' or public.can_report_message(target_id))
  );

drop policy if exists reports_select_admin on public.reports;
create policy reports_select_admin on public.reports for select to authenticated
  using ((select public.is_admin()));

-- Admin lê mensagens denunciadas (e só elas).
drop policy if exists messages_select_admin_reported on public.messages;
create policy messages_select_admin_reported on public.messages for select to authenticated
  using ((select public.is_admin()) and exists (
    select 1 from public.reports r where r.target_type = 'message' and r.target_id = messages.id::text));

revoke all on table public.reports from anon, authenticated;
grant select, insert (target_type, target_id, reason, details) on table public.reports to authenticated;

-- ---------- Ações de moderação ----------
-- p_type: tutor | review | question | answer | user (ban/unban aceita tutor ou user; p_id = uuid)
-- p_action: hide | restore | suspend | unsuspend | ban | unban | dismiss
create or replace function public.admin_moderate(
  p_type text, p_id text, p_action text, p_report bigint default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uuid uuid;
  v_big bigint;
begin
  if not public.is_admin() then
    raise exception 'Acesso restrito a administradores.' using errcode = 'P0001';
  end if;

  if p_action in ('hide', 'restore') then
    if p_type not in ('review', 'question', 'answer') or coalesce(p_id, '') !~ '^[0-9]{1,18}$' then
      raise exception 'Ação inválida para este item.' using errcode = 'P0001';
    end if;
    v_big := p_id::bigint;
    if p_type = 'review' then
      update public.reviews set status = case when p_action = 'hide' then 'hidden' else 'published' end
        where id = v_big;
    elsif p_type = 'question' then
      update public.questions set status = case when p_action = 'hide' then 'hidden' else 'open' end
        where id = v_big;
    else
      update public.answers set status = case when p_action = 'hide' then 'hidden' else 'published' end
        where id = v_big;
    end if;
    if not found then
      raise exception 'Item não encontrado.' using errcode = 'P0001';
    end if;

  elsif p_action in ('suspend', 'unsuspend', 'ban', 'unban') then
    if coalesce(p_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Identificador inválido.' using errcode = 'P0001';
    end if;
    v_uuid := p_id::uuid;
    if p_action in ('suspend', 'unsuspend') then
      if p_type <> 'tutor' then
        raise exception 'Só anúncios de professor podem ser suspensos.' using errcode = 'P0001';
      end if;
      update public.tutor_profiles set suspended = (p_action = 'suspend') where user_id = v_uuid;
      if not found then
        raise exception 'Professor não encontrado.' using errcode = 'P0001';
      end if;
    else
      if p_type not in ('tutor', 'user') then
        raise exception 'Ação inválida para este item.' using errcode = 'P0001';
      end if;
      update public.profiles set banned_at = case when p_action = 'ban' then now() end where id = v_uuid;
      if not found then
        raise exception 'Usuário não encontrado.' using errcode = 'P0001';
      end if;
      -- banir também tira o anúncio do ar (e desbanir devolve)
      update public.tutor_profiles set suspended = (p_action = 'ban') where user_id = v_uuid;
    end if;

  elsif p_action = 'dismiss' then
    if p_report is null then
      raise exception 'Informe a denúncia.' using errcode = 'P0001';
    end if;

  else
    raise exception 'Ação inválida.' using errcode = 'P0001';
  end if;

  if p_report is not null then
    update public.reports set
      status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end,
      resolved_at = now()
    where id = p_report;
    if not found then
      raise exception 'Denúncia não encontrada.' using errcode = 'P0001';
    end if;
  end if;
end $$;

-- ---------- LGPD: exportar os próprios dados ----------
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'exportado_em', now(),
    'conta', (select jsonb_build_object('id', u.id, 'email', u.email, 'criado_em', u.created_at)
              from auth.users u where u.id = v_uid),
    'perfil', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'perfil_professor', (select to_jsonb(t) - 'search_tsv' from public.tutor_profiles t where t.user_id = v_uid),
    'materias', coalesce((
      select jsonb_agg(jsonb_build_object('materia', s.name, 'niveis', ts.levels) order by s.name)
      from public.tutor_subjects ts join public.subjects s on s.id = ts.subject_id
      where ts.tutor_id = v_uid), '[]'::jsonb),
    'avaliacoes_escritas', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.id) from public.reviews r where r.student_id = v_uid), '[]'::jsonb),
    'avaliacoes_recebidas', coalesce((
      select jsonb_agg((to_jsonb(r) - 'student_id') || jsonb_build_object('autor', public.short_name(p.full_name))
                       order by r.id)
      from public.reviews r left join public.profiles p on p.id = r.student_id
      where r.tutor_id = v_uid), '[]'::jsonb),
    'perguntas', coalesce((
      select jsonb_agg(to_jsonb(q) - 'search_tsv' order by q.id) from public.questions q
      where q.author_id = v_uid), '[]'::jsonb),
    'respostas', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id) from public.answers a where a.tutor_id = v_uid), '[]'::jsonb),
    'conversas', coalesce((
      select jsonb_agg(to_jsonb(c) || jsonb_build_object('mensagens', coalesce((
               select jsonb_agg(jsonb_build_object('id', m.id, 'de_mim', m.sender_id = v_uid,
                                                   'texto', m.body, 'enviada_em', m.created_at) order by m.id)
               from public.messages m where m.conversation_id = c.id), '[]'::jsonb))
             order by c.created_at)
      from public.conversations c where v_uid in (c.student_id, c.tutor_id)), '[]'::jsonb),
    'pagamentos', coalesce((
      select jsonb_agg(to_jsonb(pm) order by pm.created_at) from public.payments pm
      where pm.user_id = v_uid), '[]'::jsonb),
    'denuncias', coalesce((
      select jsonb_agg(to_jsonb(rp) order by rp.id) from public.reports rp
      where rp.reporter_id = v_uid), '[]'::jsonb)
  );
end $$;

revoke execute on function public.admin_moderate(text, text, text, bigint), public.export_my_data(),
  public.can_report_message(text)
  from public, anon, authenticated;
grant execute on function public.admin_moderate(text, text, text, bigint), public.export_my_data(),
  public.can_report_message(text)
  to authenticated;
