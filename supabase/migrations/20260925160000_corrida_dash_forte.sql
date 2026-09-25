-- Corrida Quanta: dash mais forte. Cada portal pode vir no máximo a (velocidade base + 80) u/s
-- (DASH_V = 80 em corrida/index.html), então o tempo mínimo por portal usa essa velocidade.
create or replace function public.corrida_min_duration_ms(h integer)
returns bigint language sql immutable set search_path = '' as $$
  select (coalesce((select sum(99600 / (least(46, 16 + 1.1 * i) + 80)) from generate_series(0, least(h, 28) - 1) i), 0)
          + greatest(h - 28, 0) * 99600 / 126.0)::bigint;
$$;
revoke all on function public.corrida_min_duration_ms(integer) from public, anon, authenticated;
