-- Corrida Quanta: dash (seta pra cima) acelera o mundo em até 2,5x (DASH_MAX = 1,5 em corrida/index.html).
-- O tempo mínimo por portal passa a considerar essa velocidade máxima.
create or replace function public.corrida_min_duration_ms(h integer)
returns bigint language sql immutable set search_path = '' as $$
  select ((coalesce((select sum(99600 / least(46, 16 + 1.1 * i)) from generate_series(0, least(h, 28) - 1) i), 0)
          + greatest(h - 28, 0) * 99600 / 46.0) / 2.5)::bigint;
$$;
revoke all on function public.corrida_min_duration_ms(integer) from public, anon, authenticated;
