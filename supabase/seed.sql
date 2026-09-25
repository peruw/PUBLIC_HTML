-- =====================================================================
-- Portal /professores/ — dados de demonstração (SÓ dev/local).
-- 8 professores publicados, 2 alunos, uma conversa com avaliação e uma
-- dúvida respondida. Não rodar em produção.
-- IDs fixos: professores ...0001–0008, alunos ...0011–0012.
-- =====================================================================

-- ---------- Usuários (o trigger de signup cria profiles/tutor_profiles) ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-a000-000000000001', 'ana.demo@exemplo.com',      '{"role":"tutor","full_name":"Ana Silva","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000002', 'bruno.demo@exemplo.com',    '{"role":"tutor","full_name":"Bruno Costa","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000003', 'carla.demo@exemplo.com',    '{"role":"tutor","full_name":"Carla Mendes","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000004', 'diego.demo@exemplo.com',    '{"role":"tutor","full_name":"Diego Souza","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000005', 'eduarda.demo@exemplo.com',  '{"role":"tutor","full_name":"Eduarda Lima","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000006', 'felipe.demo@exemplo.com',   '{"role":"tutor","full_name":"Felipe Rocha","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000007', 'gabriela.demo@exemplo.com', '{"role":"tutor","full_name":"Gabriela Nunes","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000008', 'henrique.demo@exemplo.com', '{"role":"tutor","full_name":"Henrique Alves","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000011', 'maria.demo@exemplo.com',    '{"role":"student","full_name":"Maria Santos","accepted_terms":"true"}'),
  ('00000000-0000-4000-a000-000000000012', 'joao.demo@exemplo.com',     '{"role":"student","full_name":"João Pereira","accepted_terms":"true"}')
on conflict (id) do nothing;

-- No Supabase real o GoTrue não aceita NULL nestas colunas (lista de usuários quebra).
do $$
declare
  c text;
begin
  foreach c in array array['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                           'email_change_token_current', 'reauthentication_token', 'phone_change',
                           'phone_change_token']
  loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'auth' and table_name = 'users' and column_name = c) then
      execute format($f$update auth.users set %I = '' where %I is null and email like '%%.demo@exemplo.com'$f$, c, c);
    end if;
  end loop;
  if exists (select 1 from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and column_name = 'aud') then
    execute $f$update auth.users set aud = 'authenticated', role = 'authenticated',
                 instance_id = '00000000-0000-0000-0000-000000000000'
               where aud is null and email like '%.demo@exemplo.com'$f$;
  end if;
end $$;

-- ---------- Matérias (antes de publicar) ----------
insert into public.tutor_subjects (tutor_id, subject_id, levels)
select v.tutor::uuid, s.id, v.levels::text[]
from (values
  ('00000000-0000-4000-a000-000000000001', 'matematica',        '{fundamental,medio,vestibular}'),
  ('00000000-0000-4000-a000-000000000001', 'fisica',            '{medio,vestibular}'),
  ('00000000-0000-4000-a000-000000000001', 'calculo',           '{superior}'),
  ('00000000-0000-4000-a000-000000000002', 'ingles',            '{fundamental,medio,adulto}'),
  ('00000000-0000-4000-a000-000000000002', 'espanhol',          '{medio,adulto}'),
  ('00000000-0000-4000-a000-000000000003', 'portugues',         '{fundamental,medio}'),
  ('00000000-0000-4000-a000-000000000003', 'redacao',           '{medio,vestibular,concursos}'),
  ('00000000-0000-4000-a000-000000000003', 'literatura',        '{medio,vestibular}'),
  ('00000000-0000-4000-a000-000000000004', 'programacao',       '{superior,adulto}'),
  ('00000000-0000-4000-a000-000000000004', 'python',            '{superior,adulto}'),
  ('00000000-0000-4000-a000-000000000004', 'javascript',        '{superior,adulto}'),
  ('00000000-0000-4000-a000-000000000005', 'quimica',           '{medio,vestibular}'),
  ('00000000-0000-4000-a000-000000000005', 'biologia',          '{medio,vestibular}'),
  ('00000000-0000-4000-a000-000000000006', 'violao',            '{infantil,adulto}'),
  ('00000000-0000-4000-a000-000000000006', 'teoria-musical',    '{adulto}'),
  ('00000000-0000-4000-a000-000000000007', 'matematica',        '{infantil,fundamental}'),
  ('00000000-0000-4000-a000-000000000007', 'reforco-escolar',   '{infantil,fundamental}'),
  ('00000000-0000-4000-a000-000000000007', 'alfabetizacao',     '{infantil}'),
  ('00000000-0000-4000-a000-000000000008', 'enem',              '{medio,vestibular}'),
  ('00000000-0000-4000-a000-000000000008', 'historia',          '{fundamental,medio,vestibular}'),
  ('00000000-0000-4000-a000-000000000008', 'geografia',         '{fundamental,medio,vestibular}')
) as v(tutor, subject, levels)
join public.subjects s on s.slug = v.subject
-- o limite de matérias roda antes do ON CONFLICT: evita reinserir
where not exists (select 1 from public.tutor_subjects x where x.tutor_id = v.tutor::uuid and x.subject_id = s.id);

-- ---------- Anúncios ----------
update public.tutor_profiles tp set
  headline = v.headline, bio = v.bio, hourly_rate_cents = v.rate,
  mode_online = v.online, mode_presencial = v.presencial,
  uf = v.uf, city_ibge = v.city, city_name = v.city_name, published = true
from (values
  ('00000000-0000-4000-a000-000000000001'::uuid, 'Matemática e Física para vestibular e ENEM',
   E'Licenciada em Matemática pela USP, 10 anos preparando alunos para vestibular.\nAulas com muitos exercícios e simulados.',
   8000, true, true, 'SP', 3550308, 'São Paulo'),
  ('00000000-0000-4000-a000-000000000002'::uuid, 'Inglês e espanhol para conversação e provas',
   E'Morei 4 anos no Canadá e 2 na Espanha. Foco em conversação, TOEFL e DELE.',
   7000, true, true, 'RJ', 3304557, 'Rio de Janeiro'),
  ('00000000-0000-4000-a000-000000000003'::uuid, 'Redação nota 1000: português e literatura',
   E'Corretora de redação há 8 anos. Método próprio para a competência 5 do ENEM.',
   6000, true, false, 'SC', 4205407, 'Florianópolis'),
  ('00000000-0000-4000-a000-000000000004'::uuid, 'Programação do zero: Python e JavaScript',
   E'Desenvolvedor sênior. Aulas práticas com projetos reais, do básico ao primeiro emprego.',
   9000, true, false, 'SC', 4209102, 'Joinville'),
  ('00000000-0000-4000-a000-000000000005'::uuid, 'Química e Biologia presenciais em São Paulo',
   E'Bióloga e mestre em bioquímica. Atendo na zona oeste de São Paulo.',
   7500, false, true, 'SP', 3550308, 'São Paulo'),
  ('00000000-0000-4000-a000-000000000006'::uuid, 'Violão popular para iniciantes',
   E'Músico profissional. Aprenda suas músicas favoritas desde a primeira aula.',
   6500, true, true, 'RJ', 3304557, 'Rio de Janeiro'),
  ('00000000-0000-4000-a000-000000000007'::uuid, 'Reforço escolar e alfabetização com paciência',
   E'Pedagoga, especialista em dificuldades de aprendizagem. Matemática básica e leitura.',
   5000, true, true, 'SC', 4205407, 'Florianópolis'),
  ('00000000-0000-4000-a000-000000000008'::uuid, 'História e Geografia para o ENEM',
   E'Professor de cursinho há 12 anos. Resumos, mapas mentais e questões comentadas.',
   5500, true, false, 'SC', 4209102, 'Joinville')
) as v(id, headline, bio, rate, online, presencial, uf, city, city_name)
where tp.user_id = v.id;

-- Planos pagos (como superusuário; o cliente nunca grava estes campos)
update public.tutor_profiles set plan = 'premium', plan_expires_at = now() + interval '30 days'
  where user_id = '00000000-0000-4000-a000-000000000001';
update public.tutor_profiles set plan = 'profissional', plan_expires_at = now() + interval '30 days'
  where user_id = '00000000-0000-4000-a000-000000000002';

-- ---------- Conversa + avaliação de exemplo (Maria → Ana) ----------
insert into public.conversations (id, student_id, tutor_id, subject_id)
select '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000011',
       '00000000-0000-4000-a000-000000000001', s.id
from public.subjects s where s.slug = 'matematica'
on conflict do nothing;

insert into public.messages (conversation_id, sender_id, body)
select v.conv::uuid, v.sender::uuid, v.body
from (values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000011',
   'Oi, Ana! Preciso de ajuda com funções para o vestibular. Você tem horário à noite?'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001',
   'Oi, Maria! Tenho sim, terças e quintas às 19h. Vamos marcar uma aula experimental?')
) as v(conv, sender, body)
where not exists (select 1 from public.messages m where m.conversation_id = v.conv::uuid);

insert into public.reviews (tutor_id, student_id, rating, comment)
values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000011', 5,
        'Explica com muita calma e passa exercícios ótimos. Recomendo!')
on conflict (tutor_id, student_id) do nothing;

-- ---------- Dúvida respondida ----------
insert into public.questions (author_id, subject_id, title, body)
select '00000000-0000-4000-a000-000000000012', s.id,
       'Como resolver equação do segundo grau sem Bhaskara?',
       'Meu professor falou em soma e produto, mas não entendi quando dá para usar.'
from public.subjects s
where s.slug = 'matematica'
  and not exists (select 1 from public.questions q where q.author_id = '00000000-0000-4000-a000-000000000012');

insert into public.answers (question_id, tutor_id, body)
select q.id, '00000000-0000-4000-a000-000000000007',
       E'Use soma e produto quando a = 1: procure dois números cuja soma é -b e o produto é c.\nEx.: x² - 5x + 6 = 0 → 2 e 3.'
from public.questions q
where q.author_id = '00000000-0000-4000-a000-000000000012'
on conflict (question_id, tutor_id) do nothing;
