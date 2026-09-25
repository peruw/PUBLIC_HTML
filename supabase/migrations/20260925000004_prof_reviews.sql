-- =====================================================================
-- Portal /professores/ — 004 avaliações
-- Um aluno avalia um professor uma vez (pode editar). Só avalia quem tem
-- conversa com o professor e já recebeu resposta dele (can_review).
-- =====================================================================

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  tutor_id uuid not null references public.tutor_profiles (user_id) on delete cascade,
  student_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 2000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tutor_id, student_id),
  check (tutor_id <> student_id)
);
create index if not exists reviews_tutor_idx on public.reviews (tutor_id, created_at desc)
  where status = 'published';
create index if not exists reviews_student_idx on public.reviews (student_id);

-- Pode avaliar: tem conversa com o professor e ele respondeu ao menos uma vez.
create or replace function public.can_review(p_tutor uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.student_id = (select auth.uid()) and c.tutor_id = p_tutor
      and exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = p_tutor)
  )
$$;

-- Recalcula média/contagem (só avaliações publicadas).
create or replace function public.refresh_tutor_rating() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_tutor uuid;
begin
  if tg_op = 'DELETE' then
    v_tutor := old.tutor_id;
  else
    v_tutor := new.tutor_id;
  end if;
  update public.tutor_profiles tp set
    rating_avg = coalesce((select round(avg(r.rating), 2) from public.reviews r
                           where r.tutor_id = v_tutor and r.status = 'published'), 0),
    rating_count = (select count(*) from public.reviews r
                    where r.tutor_id = v_tutor and r.status = 'published')
  where tp.user_id = v_tutor;
  return null;
end $$;

drop trigger if exists refresh_tutor_rating on public.reviews;
create trigger refresh_tutor_rating after insert or update or delete on public.reviews
  for each row execute function public.refresh_tutor_rating();

drop trigger if exists reviews_updated_at on public.reviews;
create trigger reviews_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();

-- Campo computado (PostgREST): .select('id,rating,comment,created_at,reviewer_name')
-- Só responde para uma avaliação que existe de fato (não vira oráculo de nomes).
create or replace function public.reviewer_name(public.reviews) returns text
language sql stable security definer set search_path = ''
as $$
  select public.short_name(p.full_name)
  from public.profiles p
  where p.id = $1.student_id
    and exists (select 1 from public.reviews r where r.id = $1.id and r.student_id = $1.student_id)
$$;

-- ---------- RLS ----------
alter table public.reviews enable row level security;

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to anon, authenticated
  using (status = 'published' or student_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated
  with check (student_id = (select auth.uid())
              and public.can_review(tutor_id)
              and (select public.is_active_user()));

drop policy if exists reviews_update_own on public.reviews;
create policy reviews_update_own on public.reviews for update to authenticated
  using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));

drop policy if exists reviews_delete_own on public.reviews;
create policy reviews_delete_own on public.reviews for delete to authenticated
  using (student_id = (select auth.uid()));

-- ---------- Grants ----------
revoke all on table public.reviews from anon, authenticated;
grant select on table public.reviews to anon, authenticated;
grant insert (tutor_id, rating, comment), update (rating, comment), delete on table public.reviews to authenticated;

revoke execute on function public.refresh_tutor_rating() from public, anon, authenticated;
revoke execute on function public.can_review(uuid), public.reviewer_name(public.reviews)
  from public, anon, authenticated;
grant execute on function public.can_review(uuid) to authenticated;
grant execute on function public.reviewer_name(public.reviews) to anon, authenticated;
