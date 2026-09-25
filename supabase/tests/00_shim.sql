-- =====================================================================
-- Shim do Supabase para testes locais (Postgres puro, sem Docker).
-- Reproduz o mínimo que as migrações usam: papéis, schemas auth/storage/
-- extensions, auth.uid(), storage.foldername(), publication do Realtime e
-- os default privileges do Supabase (ALL para anon/authenticated/service_role).
-- NÃO aplicar em projeto Supabase real.
-- =====================================================================

-- ---------- Papéis ----------
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

-- ---------- Schemas ----------
create schema extensions;
create schema auth;
create schema storage;
grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

-- ---------- auth ----------
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Igual ao Supabase: lê o "sub" do JWT repassado pelo PostgREST.
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- ---------- storage ----------
create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid default auth.uid(),
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- Igual ao Supabase: "uid/pasta/arquivo.webp" -> {uid,pasta}
create function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

grant all on table storage.buckets, storage.objects to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ---------- Realtime ----------
create publication supabase_realtime;

-- ---------- Default privileges (o Supabase concede tudo; as migrações revogam) ----------
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------- Conta criada antes das migrações do portal (testa o backfill de profiles) ----------
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-e000-000000000001', 'antiga@teste.local', '{"name":"  Conta   Antiga "}');
