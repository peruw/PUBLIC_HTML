# Supabase do projeto "fisora" (Corrida Quanta)

Migrações do jogo `/corrida/` (ranking, apelidos e progresso). Elas vão no projeto **fisora**
(`rnbyvrzarzvkvixtxoli`), o mesmo do login Google dos outros apps da Quanta — **não** no projeto
`quanta-professores`, que usa a pasta `supabase/`.

Já aplicadas, na ordem:
1. `20260925120000_corrida_quanta.sql` — tabelas, RLS e funções do ranking
2. `20260925150000_corrida_dash.sql` — tempo mínimo com dash
3. `20260925160000_corrida_dash_forte.sql` — dash mais forte (velocidade base + 80)
