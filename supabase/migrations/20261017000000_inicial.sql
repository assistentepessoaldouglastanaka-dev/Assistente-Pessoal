-- Assistente pessoal: armazenamento sincronizado entre PC, notebook, celular e Alexa.
-- Cada item do app (tarefa, gasto, evento, treino...) é uma linha em `itens`, identificada por (usuário, coleção, id).
-- Configurações únicas (config, renda, planejamento semanal...) usam a coleção '_unico'.

create table public.itens (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  colecao       text not null,
  id            text not null,
  dados         jsonb,
  excluido      boolean not null default false,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, colecao, id)
);

create index itens_user_atualizado_idx on public.itens (user_id, atualizado_em);

alter table public.itens enable row level security;

create policy "itens_select_dono" on public.itens for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "itens_insert_dono" on public.itens for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "itens_update_dono" on public.itens for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "itens_delete_dono" on public.itens for delete to authenticated
  using ((select auth.uid()) = user_id);

-- O servidor define o horário da alteração (base da sincronização incremental)
create function public.tocar_atualizado_em() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create trigger itens_tocar_atualizado_em before insert or update on public.itens
  for each row execute function public.tocar_atualizado_em();

-- Mudanças chegam em tempo real nos outros aparelhos
alter publication supabase_realtime add table public.itens;

-- Tokens do Google (Agenda, Tasks, Gmail). O app só grava; quem lê são as Edge Functions (service role).
create table public.integracoes (
  user_id       uuid not null references auth.users (id) on delete cascade,
  provedor      text not null,
  refresh_token text,
  escopos       text,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, provedor)
);

alter table public.integracoes enable row level security;
-- Sem policies: nenhum acesso direto pelo app. A gravação passa pela função abaixo.

create function public.salvar_token_google(p_refresh_token text, p_escopos text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  insert into public.integracoes (user_id, provedor, refresh_token, escopos, atualizado_em)
  values (auth.uid(), 'google', p_refresh_token, p_escopos, now())
  on conflict (user_id, provedor) do update
    set refresh_token = excluded.refresh_token, escopos = excluded.escopos, atualizado_em = now();
end $$;

revoke execute on function public.salvar_token_google(text, text) from public, anon;
grant execute on function public.salvar_token_google(text, text) to authenticated;
