-- Portal /professores/ — 008: privacidade do aluno nas conversas
-- O aluno aparece para o professor com nome abreviado ("Maria S."), como prometido no cadastro e
-- na política de privacidade. O professor deixa de ler a linha completa do aluno em profiles.

create or replace function public.list_conversations()
returns table (
  id uuid, other_id uuid, other_name text, other_avatar text, other_slug text, i_am text,
  last_message_at timestamptz, last_body text, unread boolean)
language sql stable security definer set search_path = ''
as $$
  with me as (select auth.uid() as uid)
  select c.id,
         o.id,
         -- aluno vê o nome do professor; professor vê o aluno abreviado
         case when c.student_id = me.uid then o.full_name else public.short_name(o.full_name) end,
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

-- Só o aluno lê o perfil do professor com quem conversa (mesmo se o anúncio sair do ar);
-- o professor não lê a linha do aluno.
drop policy if exists profiles_read_counterpart on public.profiles;
create policy profiles_read_counterpart on public.profiles for select to authenticated
  using (role = 'tutor' and public.shares_conversation(id));
