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

## App Android (Capacitor)

`mobile/` contém o app Android. Ele abre o app publicado na Vercel e adiciona alarmes/lembretes nativos
(tocam com o app fechado), login com Google pelo navegador do sistema e botão voltar.

Pré-requisito: Android Studio. Para gerar o APK:

```bash
cd mobile
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```

O APK fica em `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
No Supabase (Authentication → URL Configuration → Redirect URLs) é preciso ter `br.com.assistentepessoal://login`.

## Jarvis (assistente de voz)

Toque no reator, use Alt+J no computador ou diga "Jarvis" (no Chrome, se ativado em Notas e ajustes).
Comandos comuns (gastos, tarefas, eventos, alarmes, lembretes e consultas) são entendidos por regras no próprio app: grátis e offline.
Perguntas livres vão para a Edge Function `jarvis`, que usa a IA gratuita da Cloudflare (Workers AI, 10.000 neurons/dia).

Secrets da função `jarvis` no Supabase: `CF_ACCOUNT_ID`, `CF_API_TOKEN` (permissão Workers AI) e, opcional, `CF_MODELO`.
