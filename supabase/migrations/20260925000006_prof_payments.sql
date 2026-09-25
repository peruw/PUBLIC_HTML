-- =====================================================================
-- Portal /professores/ — 006 pagamentos (Mercado Pago Checkout Pro)
-- payments.id = external_reference no MP. O cliente só lê os próprios;
-- quem cria é a Edge Function create-checkout (service_role) e quem
-- aplica é o webhook via apply_payment (EXECUTE só para service_role).
-- =====================================================================

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  plan text not null references public.plans (code) check (plan <> 'basico'),
  months smallint not null check (months in (1, 3, 12)),
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'cancelled', 'in_process', 'refunded', 'charged_back', 'amount_mismatch')),
  mp_preference_id text,
  mp_payment_id text unique,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Aplica o resultado de um pagamento consultado na API do MP.
-- Idempotente; confere o valor; estende a validade do plano.
-- Retorna: applied | already_applied | amount_mismatch | reversed | updated | ignored | conflict | not_found | no_tutor
create or replace function public.apply_payment(
  p_id uuid, p_mp_payment_id text, p_status text, p_amount_cents int, p_raw jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_status text := p_status;
begin
  select * into v_pay from public.payments where id = p_id for update;
  if not found then
    return 'not_found';
  end if;

  if p_status is null or p_status not in (
    'pending', 'approved', 'rejected', 'cancelled', 'in_process', 'refunded', 'charged_back') then
    return 'ignored';
  end if;

  -- o mesmo pagamento do MP não pode quitar duas referências
  if p_mp_payment_id is not null and exists (
    select 1 from public.payments x where x.mp_payment_id = p_mp_payment_id and x.id <> p_id) then
    return 'conflict';
  end if;

  if v_pay.status = 'approved' then
    if p_status in ('refunded', 'charged_back', 'cancelled') then
      -- estorno: registra e devolve os meses concedidos (se o plano ainda é o mesmo)
      update public.payments set status = p_status, raw = coalesce(p_raw, raw) where id = p_id;
      update public.tutor_profiles tp
        set plan_expires_at = tp.plan_expires_at - make_interval(months => v_pay.months)
        where tp.user_id = v_pay.user_id and tp.plan = v_pay.plan and tp.plan_expires_at is not null;
      return 'reversed';
    end if;
    return 'already_applied';
  end if;

  if p_status = 'approved' and p_amount_cents is distinct from v_pay.amount_cents then
    v_status := 'amount_mismatch';
  end if;

  update public.payments set
    status = v_status,
    mp_payment_id = coalesce(p_mp_payment_id, mp_payment_id),
    raw = coalesce(p_raw, raw)
  where id = p_id;

  if v_status <> 'approved' then
    return case when v_status = 'amount_mismatch' then 'amount_mismatch' else 'updated' end;
  end if;

  -- renova a partir da validade atual se for o mesmo plano ainda ativo; senão a partir de agora
  update public.tutor_profiles tp set
    plan = v_pay.plan,
    plan_expires_at = (case when tp.plan = v_pay.plan and tp.plan_expires_at > now()
                            then tp.plan_expires_at else now() end)
                      + make_interval(months => v_pay.months)
  where tp.user_id = v_pay.user_id;
  if not found then
    return 'no_tutor';
  end if;
  return 'applied';
end $$;

-- ---------- RLS ----------
alter table public.payments enable row level security;

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Grants ----------
revoke all on table public.payments from anon, authenticated;
grant select on table public.payments to authenticated;

revoke execute on function public.apply_payment(uuid, text, text, int, jsonb) from public, anon, authenticated;
grant execute on function public.apply_payment(uuid, text, text, int, jsonb) to service_role;
