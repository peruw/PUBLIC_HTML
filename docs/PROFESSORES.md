# Portal de professores (`/professores/`)

Guia técnico e de configuração do portal de professores particulares do Quanta Aulas
(inspirado no antigo Profes.com.br): busca de professores, perfil público, cadastro de
aluno e professor, mensagens internas, avaliações, tira-dúvidas, planos pagos com Mercado
Pago e moderação.

- Frontend: páginas estáticas (Vite 5, multipágina) servidas pela Hostinger a partir de `dist/`.
- Backend: Supabase (Postgres + Auth + Storage + Realtime + Edge Functions), projeto
  `cmwfclgizvjtwpfyaucp`, região São Paulo (`sa-east-1`).

---

## 1. Arquitetura

```
                        Hostinger (dist/ gerado pelo "npm run build")
                        ┌───────────────────────────────────────────────┐
  Navegador ───────────►│ /professores/*.html + JS/CSS empacotados       │
  (aluno, professor,    │ .htaccess: /professores/p/<slug> -> perfil.html │
   admin)               └───────────────────────────────────────────────┘
      │
      │  supabase-js (URL + chave publishable, públicas por design)
      │  sessão PKCE no localStorage; toda autorização é feita pelo RLS
      │
      ├──► Auth ............ cadastro, login, confirmação e senha (e-mails pelo SMTP próprio)
      ├──► REST /rest/v1 ... tabelas e RPCs (search_tutors, start_conversation, can_review...)
      ├──► Realtime ........ INSERT em public.messages da conversa aberta (fallback: polling 10 s)
      ├──► Storage ......... bucket "avatars" (público; escrita só em <uid>/)
      └──► Edge Functions
             ├─ create-checkout ──► API do Mercado Pago (cria a preferência) ──► checkout do MP
             │                                                                   │
             │     pagamento.html ◄── volta do MP (?external_reference=<payments.id>)
             │     (só CONSULTA o status; o navegador nunca concede plano)
             └─ delete-account ───► apaga os avatares e o usuário (auth.admin.deleteUser)

  Mercado Pago ──(webhook assinado x-signature)──► mp-webhook
                    └─► GET api.mercadopago.com/v1/payments/{id}  (nunca confia no corpo)
                    └─► rpc apply_payment()  (só service_role; idempotente; estende a validade)

  INSERT em public.messages ──(Database Webhook + x-webhook-secret)──► notify-message
                    └─► Resend: e-mail "você recebeu uma mensagem" (no máx. 1 a cada 30 min por conversa)
```

### Páginas

| URL | Módulo | O que faz |
|---|---|---|
| `/professores/` | `js/pages/busca.js` | Busca com filtros na URL (`?q=&materia=&uf=&cidade=&modo=&min=&max=&ordem=&pagina=`) via `rpc('search_tutors')` |
| `/professores/p/<slug>` | `js/pages/perfil.js` | Perfil público; monta contato, avaliações, respostas e denúncia |
| `entrar.html` | `js/pages/entrar.js` | Entrar, cadastro (aluno/professor, 18+ e termos), esqueci a senha, nova senha |
| `painel.html` | `js/pages/painel.js` | Painel com abas (anúncio, matérias, foto, avaliações, dúvidas, plano, conta) |
| `mensagens.html` | `js/pages/mensagens.js` | Conversas (lista + conversa, Realtime) |
| `duvidas.html` / `duvida.html?q=<id>` | `js/pages/duvidas.js` / `duvida.js` | Tira-dúvidas: perguntas de alunos, respostas de professores |
| `planos.html` / `pagamento.html` | `js/pages/planos.js` / `pagamento.js` | Planos, compra (Mercado Pago) e retorno do pagamento |
| `admin.html` | `js/pages/admin.js` | Fila de denúncias e moderação (só `is_admin`) |
| `privacidade.html` / `termos.html` | estáticas | Política de privacidade (LGPD) e Termos de Uso (minutas) |

Páginas privadas (`painel`, `mensagens`, `entrar`, `pagamento`, `admin`) têm `noindex` e
`Disallow` no `robots.txt`.

### Arquivos

```
professores/
  *.html                     uma página por arquivo (entradas do Vite geradas automaticamente)
  partials/nav.html, footer.html   inseridos no build por <!-- @include ... --> (plugin do vite.config.js)
  css/professores.css        base compartilhada (formulários, cards, chips, modal, toast, abas)
  css/<área>.css             CSS de cada área, importado pelo módulo JS da página/componente
  data/municipios/<UF>.json  municípios do IBGE (gerados por "npm run municipios")
  js/config.js               URL e chave publishable do Supabase (override: VITE_SUPABASE_URL/ANON_KEY)
  js/supabase.js             cliente único (flowType 'pkce'), fnUrl(), avatarPublicUrl()
  js/auth.js                 sessão, perfil, requireAuth(), slot de login do nav, badge de não lidas
  js/ui.js                   h() (criação segura de elementos), toast, modal, errorMsg(), formatação
  js/municipios.js           UFs e seletor de cidade
  js/components/*.js         contato, avaliações, respostas, denúncia e as abas do painel
  js/pages/*.js              um módulo por página
supabase/
  migrations/…0001…0007.sql  esquema, RLS, RPCs (fonte da verdade de tabelas, grants e policies)
  seed.sql                   professores e alunos de demonstração (SÓ desenvolvimento)
  functions/                 Edge Functions (Deno) + _shared/
  tests/                     shim do Supabase + asserções de RLS (npm run test:db)
tests/e2e/*.spec.js          Playwright com Supabase falso (http://supabase.test)
```

### Regras que todo código novo deve seguir

- **XSS:** conteúdo de usuário entra no DOM só como texto (`h()`/`textContent`). Nunca `innerHTML`.
  Links de usuário não viram `<a>`; a única URL vinda do banco é a do avatar, validada por `avatarPublicUrl()`.
- **Segurança no banco, não no navegador:** o cliente só envia colunas com `grant`; campos como
  `plan`, `plan_expires_at`, `rating_*`, `suspended` e `status` não são graváveis pelo cliente.
- **Denúncia (`reports`)**: insert **sem** `.select()` (quem denuncia não pode ler `reports`).
- **Matérias (`tutor_subjects`)**: `insert` para novas, `update({ levels })` para níveis; nunca o `upsert` padrão.
- **`isConfigured === false`** (placeholders no `config.js`): as páginas mostram "Portal em configuração".
- Sem `.reveal` em conteúdo inserido depois (ou chame `observeReveal()`); layout precisa funcionar em 360 px.

---

## 2. Como rodar

Requisitos: Node 22.18+ (os testes das funções rodam `.ts` direto no Node) e, para os testes
de banco, PostgreSQL 16+ instalado localmente (não precisa de Docker).

```bash
npm install
npx playwright install chromium     # só na primeira vez (testes e2e)

npm run dev          # http://localhost:5173/professores/  (usa o Supabase de produção do config.js)
npm run build        # gera dist/ (site antigo + portal); é o que vai para a Hostinger
npm run preview      # serve o dist/ em http://localhost:4173

npm run test:e2e     # Playwright: todas as páginas com o Supabase FALSO (http://supabase.test)
npm run test:db      # Postgres temporário: shim do Supabase + migrações + seed + asserções de RLS
npm run test:fn      # node --test das partes testáveis das Edge Functions (assinatura do MP, CORS, storage)
npm run municipios   # regenera professores/data/municipios/*.json
```

Dicas:

- Para apontar o dev para outro projeto (ex.: um projeto de teste), crie `.env.local` (não vai para o git):
  `VITE_SUPABASE_URL=https://<ref>.supabase.co` e `VITE_SUPABASE_ANON_KEY=<publishable key>`.
- Rodar suítes em paralelo: `E2E_PORT=4221 npx playwright test tests/e2e/busca.spec.js`
  (cada porta usa sua própria pasta de build em `.vite/`).
- `tests/e2e/fluxos.spec.js` tem os fluxos ponta a ponta (busca → perfil → login → mensagem;
  avaliação; painel; compra de plano; denúncia → admin) com um Supabase falso com memória.
- O `seed.sql` cria usuários fictícios. **Nunca** rode o seed no projeto de produção.

---

## 3. Configuração do Supabase (passo a passo)

### 3.1 Banco

1. Aplique as migrações **em ordem** (`supabase/migrations/20260925000001…0007`):
   - com o CLI: `npx supabase login`, `npx supabase link --project-ref cmwfclgizvjtwpfyaucp`, `npx supabase db push`;
   - ou cole cada arquivo no **SQL Editor**, do 0001 ao 0007.
2. Confira em **Database → Publications** que `supabase_realtime` inclui `public.messages` (a migração 0003 faz isso).
3. Confira em **Storage** o bucket `avatars` (público, 2 MB, JPEG/PNG/WebP; criado pela 0002).
4. Rode o **Advisors → Security Advisor**. Aviso esperado: as funções `is_public_tutor`, `is_admin`,
   `reviewer_name` e `author_name` são `SECURITY DEFINER` executáveis por `anon` de propósito.

### 3.2 Chaves no frontend

`professores/js/config.js` já tem a URL do projeto e a chave **publishable** (pública por design; a
segurança vem do RLS). Nunca coloque a `service_role`/secret key no frontend nem no repositório.

### 3.3 Auth → URL Configuration

- **Site URL:** `https://quantaaulas.com/professores/`
- **Redirect URLs** (lista de permitidos):
  - `https://quantaaulas.com/professores/**`
  - `http://localhost:5173/**` (desenvolvimento)
  - `http://localhost:4173/**` (preview local, opcional)

Os links de e-mail usam o fluxo **PKCE**: voltam como `…/professores/entrar.html?code=…` e só funcionam
**no mesmo navegador** que pediu o cadastro/recuperação (o `code_verifier` fica no localStorage dele).
Redirecionamentos que o site pede:

- Confirmação de cadastro: `https://quantaaulas.com/professores/entrar.html?modo=entrar&confirmado=1&next=/professores/painel.html?bemvindo=1`
- Recuperação de senha: `https://quantaaulas.com/professores/entrar.html?modo=nova-senha`

Recomendado: redirecionar `www.quantaaulas.com` para `quantaaulas.com` no `.htaccess` (senão um link
pedido em `www` abre no outro endereço, sem a sessão, e o login não completa):

```apache
RewriteCond %{HTTP_HOST} ^www\.quantaaulas\.com$ [NC]
RewriteRule ^(.*)$ https://quantaaulas.com/$1 [R=301,L]
```

### 3.4 Auth → Providers → Email e senhas

- **Confirm email: ON** (obrigatório: sem isso qualquer um cria conta com e-mail alheio).
- **Secure password change: ON** (se o Supabase pedir reautenticação, a aba Conta orienta o usuário a sair e entrar de novo).
- **Minimum password length: 8** e **Password requirements: letras e dígitos** (as mesmas regras do `entrar.js`).
- Opcional: **Leaked password protection** (plano Pro).
- Cadastros com Google/Apple não estão implementados na v1: o aceite dos termos só é gravado no cadastro por e-mail.

### 3.5 SMTP próprio (obrigatório para produção)

O SMTP padrão do Supabase só envia para membros da equipe do projeto e tem limite baixíssimo.
Em **Auth → SMTP Settings → Enable custom SMTP**:

**Opção A — e-mail da Hostinger**

| Campo | Valor |
|---|---|
| Host | `smtp.hostinger.com` |
| Porta | `465` (SSL) |
| Usuário | o e-mail completo, ex.: `nao-responda@quantaaulas.com` |
| Senha | a senha dessa caixa de e-mail |
| Remetente | `nao-responda@quantaaulas.com`, nome "Quanta Aulas" |

**Opção B — Resend**

| Campo | Valor |
|---|---|
| Host | `smtp.resend.com` |
| Porta | `465` |
| Usuário | `resend` |
| Senha | uma API key do Resend |
| Remetente | um endereço do domínio verificado no Resend |

Em qualquer opção, configure **SPF, DKIM e DMARC** do domínio (no DNS da Hostinger) para os e-mails
não caírem no spam. Depois ajuste **Auth → Rate Limits → e-mails por hora** (ex.: 100).

### 3.6 Templates de e-mail (Auth → Email Templates), em português

Use sempre `{{ .ConfirmationURL }}` (é ele que leva o `code` do PKCE).

**Confirm signup** — assunto: `Confirme seu e-mail no Quanta Aulas`

```html
<h2>Falta pouco!</h2>
<p>Olá! Confirme seu e-mail para ativar sua conta no portal de professores do Quanta Aulas.</p>
<p><a href="{{ .ConfirmationURL }}">Confirmar meu e-mail</a></p>
<p>Abra o link no mesmo navegador em que você fez o cadastro.</p>
<p>Se você não criou esta conta, ignore este e-mail.</p>
```

**Reset password** — assunto: `Redefinir sua senha do Quanta Aulas`

```html
<h2>Redefinição de senha</h2>
<p>Recebemos um pedido para redefinir a senha da sua conta.</p>
<p><a href="{{ .ConfirmationURL }}">Criar uma nova senha</a></p>
<p>Abra o link no mesmo navegador em que você pediu a redefinição. O link expira em 1 hora.</p>
<p>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
```

**Change email address** — assunto: `Confirme seu novo e-mail`

```html
<h2>Confirme a troca de e-mail</h2>
<p>Clique para confirmar a troca do e-mail da sua conta de {{ .Email }} para {{ .NewEmail }}.</p>
<p><a href="{{ .ConfirmationURL }}">Confirmar novo e-mail</a></p>
```

**Magic link** (não usado pelo site, mas deixe em PT) — assunto: `Seu link de acesso ao Quanta Aulas`

```html
<p><a href="{{ .ConfirmationURL }}">Entrar no Quanta Aulas</a></p>
<p>Se você não pediu este link, ignore este e-mail.</p>
```

### 3.7 CAPTCHA (opcional)

**Auth → Bot and Abuse Protection** permite hCaptcha ou Cloudflare Turnstile. **Atenção:** com o
CAPTCHA ligado, o Supabase recusa cadastro/login/recuperação sem `captchaToken`, e o `entrar.js`
ainda não envia esse token. Ligar o CAPTCHA exige antes adicionar o widget ao `entrar.js`
(`options: { captchaToken }` em `signUp`, `signInWithPassword` e `resetPasswordForEmail`).
Até lá, a proteção vem dos rate limits do Auth e dos limites no banco (10 contatos novos/dia,
5 perguntas/dia, 20 denúncias/dia etc.).

---

## 4. Edge Functions e segredos

### 4.1 Deploy

```bash
npx supabase functions deploy create-checkout
npx supabase functions deploy mp-webhook
npx supabase functions deploy delete-account
npx supabase functions deploy notify-message
```

- O `supabase/config.toml` já define `verify_jwt = false` nas quatro: `create-checkout` e
  `delete-account` validam o usuário no código (`auth.getUser`); `mp-webhook` é autenticada pela
  assinatura do Mercado Pago; `notify-message` pelo cabeçalho `x-webhook-secret`. Se publicar pelo
  painel, desligue "Enforce JWT verification" em cada uma.
- As funções importam `../_shared/cors.ts`, `mp.ts`, `supabase.ts` e `storage.ts`; o CLI empacota
  isso sozinho. Os arquivos `*.test.ts` e `_shared/index.js` não vão para produção.

### 4.2 Segredos (Edge Functions → Secrets, ou `npx supabase secrets set NOME=valor`)

| Segredo | Valor | Usado por |
|---|---|---|
| `MP_ACCESS_TOKEN` | Access Token do Mercado Pago (de teste ou de produção) | create-checkout, mp-webhook |
| `MP_WEBHOOK_SECRET` | "Assinatura secreta" dos Webhooks do MP (ver 4.3). **Sem ele toda notificação é recusada (401) e nenhum plano é ativado** | mp-webhook |
| `MP_SANDBOX` | `true` com credenciais de teste (usa `sandbox_init_point`); `false` em produção | create-checkout |
| `SITE_URL` | `https://quantaaulas.com` (sem `/professores`) — base das URLs de volta do MP e dos links dos e-mails | create-checkout, notify-message |
| `ALLOWED_ORIGINS` | `https://quantaaulas.com` (e `http://localhost:5173` para dev), separados por vírgula | CORS de todas |
| `RESEND_API_KEY` | API key do Resend (sem ela o aviso por e-mail fica desligado, sem erro) | notify-message |
| `EMAIL_FROM` | ex.: `Quanta Aulas <nao-responda@quantaaulas.com>` (domínio verificado no Resend) | notify-message |
| `NOTIFY_WEBHOOK_SECRET` | um valor aleatório longo (ex.: `openssl rand -hex 32`) | notify-message |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e a service role / secret keys são injetados pelo próprio Supabase.
Nunca cole tokens no chat, em issues ou no repositório.

### 4.3 Webhook no painel do Mercado Pago

1. Em <https://www.mercadopago.com.br/developers/panel/app>, abra a aplicação do Quanta Aulas.
2. Menu **Webhooks → Configurar notificações**.
3. **URL de produção** (e também a de teste, se for testar com credenciais de teste):
   `https://cmwfclgizvjtwpfyaucp.supabase.co/functions/v1/mp-webhook`
4. **Eventos:** marque só **Pagamentos** (`payment`).
5. Salve e copie a **Assinatura secreta** gerada → segredo `MP_WEBHOOK_SECRET` no Supabase.
6. Use **Simular notificação** do painel: a função responde 200 (ignora ids que não são nossos).

Observações:

- A preferência criada pelo `create-checkout` também envia `notification_url` =
  `…/functions/v1/mp-webhook?source_news=webhooks` (só notificações assinadas; sem IPN).
- A função consulta o pagamento na API do MP e só então chama `apply_payment` (idempotente).
- Nos logs da função (**Edge Functions → mp-webhook → Logs**), linhas com
  `verificar/estornar manualmente` (`superseded`, `amount_mismatch`, `conflict`, `no_tutor`, `not_found`)
  indicam pagamento que precisa de **estorno ou análise manual** no painel do MP.
  `superseded` = o professor pagou um plano inferior com um superior ainda ativo: fica aprovado,
  não é aplicado (`payments.applied_at` nulo) e o site avisa que o valor será devolvido.

### 4.4 Database Webhook para `notify-message`

**Database → Webhooks → Create a new hook**:

| Campo | Valor |
|---|---|
| Name | `notify_message` |
| Table | `public.messages` |
| Events | **Insert** |
| Type | HTTP Request (ou "Supabase Edge Functions") |
| Method / URL | `POST` `https://cmwfclgizvjtwpfyaucp.supabase.co/functions/v1/notify-message` |
| HTTP Headers | `Content-Type: application/json` e `x-webhook-secret: <NOTIFY_WEBHOOK_SECRET>` |
| Timeout | 5000 ms |

A função só envia e-mail se o destinatário ainda não leu e não foi avisado nos últimos 30 minutos
naquela conversa.

---

## 5. Administração

### 5.1 Primeiro admin

Crie a conta normalmente pelo site e depois, no **SQL Editor**:

```sql
update public.profiles
   set is_admin = true
 where id = (select id from auth.users where email = 'seu-email@quantaaulas.com');
```

`is_admin` não pode ser alterado pelo cliente nem pelo metadata do cadastro.

### 5.2 Moderação (`/professores/admin.html`)

- Página com `noindex` e bloqueada no `robots.txt`; só abre para `is_admin`.
- Ações via `rpc('admin_moderate')`: **ocultar/restaurar** (avaliação, pergunta, resposta),
  **suspender/reativar anúncio** (tira o professor da busca; a conta continua ativa) e
  **banir/desbanir usuário** (`profiles.banned_at`: não envia mensagens, não publica, não edita).
- Banir e suspender são independentes: **desbanir não reativa um anúncio suspenso** (faça "Reativar anúncio" separadamente).
- Ao resolver uma denúncia, o admin pode resolver junto as outras denúncias abertas do mesmo item.

### 5.3 Pedidos LGPD

- Exportação: o próprio usuário baixa um JSON em **Painel → Conta → Exportar meus dados** (`export_my_data`).
- Exclusão: **Painel → Conta → Excluir minha conta** (digitar EXCLUIR) chama `delete-account`, que apaga
  avatares e o usuário; os dados ligados caem em cascata. Pagamentos ficam com `user_id` nulo (registro fiscal).

---

## 6. Preços dos planos

Os preços ficam na tabela `public.plans` (centavos por mês). O site sempre lê o valor final de
`rpc('plan_price')`, que aplica 10% de desconto em 3 meses e 25% em 12 meses. Exemplo:

```sql
update public.plans set price_cents_month = 3490 where code = 'profissional'; -- R$ 34,90/mês
update public.plans set price_cents_month = 6990 where code = 'premium';      -- R$ 69,90/mês
update public.plans set max_subjects = 12 where code = 'profissional';
```

- Para mudar os descontos, altere a função `public.plan_price` (fonte única do valor cobrado; o
  `create-checkout` também usa).
- `basico` é sempre grátis e não pode ser comprado.
- Mudanças valem para compras novas; pagamentos já criados mantêm o valor registrado.

---

## 7. Deploy do site (Hostinger)

1. `npm run build` (confira que `dist/professores/` foi gerado).
2. Envie o conteúdo de `dist/` para `public_html/` (o `.htaccess` vai junto, reescreve
   `/professores/p/<slug>` para `perfil.html` e envia `X-Frame-Options: SAMEORIGIN` e
   `Content-Security-Policy: frame-ancestors 'self'`, que impedem outro site de exibir as páginas
   num iframe (clickjacking)).
3. Teste: `/professores/`, um perfil `/professores/p/<slug>`, cadastro com confirmação por e-mail,
   recuperação de senha e uma compra com credenciais de teste do MP. Confira também os dois
   cabeçalhos acima (`curl -sI https://quantaaulas.com/professores/ | grep -i -e x-frame -e frame-ancestors`).
   Se não aparecerem (servidor sem `mod_headers`), o portal ainda se esconde sozinho dentro de
   iframes de outros sites (`ui.js`), mas vale pedir o módulo ao suporte.

SEO: título, descrição, `canonical`, Open Graph e JSON-LD dos perfis e das dúvidas são definidos
por JavaScript. O Google executa JS e vê tudo; prévias de link no WhatsApp/Facebook não. Se a
Hostinger executar PHP, a fase opcional `perfil.php` + `sitemap.php` resolve isso.

---

## 8. Checklist de lançamento

**Jurídico e fiscal**

- [ ] CNPJ (ou MEI com atividade compatível) para vender planos; conta do Mercado Pago no CNPJ.
- [ ] Emissão de **NFS-e** para cada plano vendido (prefeitura ou emissor integrado).
- [ ] Revisão jurídica de `privacidade.html` e `termos.html` (são minutas; há um aviso em comentário HTML).
- [x] Dados do controlador preenchidos nos termos e na privacidade (ver "Dados do responsável" abaixo).
- [ ] Endereço físico completo (o Decreto 7.962/2013 pede endereço físico para venda pela internet; hoje consta só Joinville/SC).
- [ ] **LGPD:** nomear o encarregado (DPO) e publicar o contato; registro das operações de tratamento;
      conferir bases legais e prazos de retenção; canal para pedidos de titulares (exportar/excluir já existem no painel).
- [ ] Direito de arrependimento (CDC art. 49, 7 dias): processo de estorno no painel do MP definido.

**Supabase**

- [x] Migrações 0001–0008 aplicadas; Security Advisor revisado.
- [ ] Site URL e Redirect URLs (3.3); Confirm email ON; regras de senha (3.4).
- [ ] SMTP próprio com SPF/DKIM/DMARC; templates em PT; teste de cadastro e de "esqueci a senha" num e-mail externo.
- [ ] Edge Functions publicadas; todos os segredos definidos; `MP_SANDBOX=false` com o token de produção.
- [ ] Webhook do Mercado Pago com a assinatura secreta; compra real de valor baixo testada e estornada.
- [ ] Database Webhook do `notify-message` criado e testado (mensagem → e-mail).
- [ ] Primeiro admin criado (5.1).
- [ ] **Backup:** o plano Free não tem backups diários utilizáveis nem PITR. Antes de vender planos,
      migrar para o **plano Pro** (backups diários; PITR opcional) ou, no mínimo, agendar `pg_dump` externo.
- [ ] Seed de demonstração **não** aplicado em produção.

**Site**

- [ ] `npm run test:e2e`, `npm run test:db` e `npm run test:fn` verdes.
- [ ] Redirecionamento `www` → sem `www` no `.htaccess` (3.3).
- [ ] Preços dos planos revisados (6).
- [ ] Links "Professores" do site principal funcionando no celular e no desktop.

---

## Dados do responsável

Usados nos Termos de Uso e na Política de Privacidade (controlador, encarregado/DPO, foro e atendimento).

| Campo | Valor |
|---|---|
| Nome | Samuel Isidoro dos Santos Júnior |
| CPF | 080.930.309-48 |
| Cidade/UF (sede e foro) | Joinville/SC |
| E-mail de contato e do encarregado (DPO) | aulas@isidoropreparatorio.com.br |
| Projeto Supabase | `quanta-professores` (ref `cmwfclgizvjtwpfyaucp`, região sa-east-1) |

