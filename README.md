# Assistente Pessoal

Assistente pessoal em português: tarefas do trabalho, tarefas pessoais e wishlist, controle de gastos e dívidas,
agenda, trajetos, treinos da academia, alarmes e notas — sincronizado entre PC, notebook e celular.

## Estrutura

- `assistente/` — app web (HTML/CSS/JS puro, sem build)
- `supabase/migrations/` — banco de dados (Supabase / Postgres)

## Rodar localmente

```bash
python -m http.server 8765 --directory assistente
```

Abra http://localhost:8765. Sem login, os dados ficam só no navegador; entrando com Google, sincronizam entre os aparelhos.

## Configuração

- `assistente/js/config.js` — URL do projeto Supabase e chave *publishable* (pública; a segurança vem do RLS no banco).
- Login com Google: ativar o provedor Google no Supabase (Authentication → Providers).

## Integração com o Google (Agenda, Tasks, Gmail)

A Edge Function `google-token` renova o acesso ao Google usando o refresh token salvo no login.

```bash
npx supabase login
npx supabase link --project-ref dcbjrjpbvyjavgwuchuf
npx supabase functions deploy google-token --no-verify-jwt
```

Secrets da função (Supabase → Edge Functions → Secrets): `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
