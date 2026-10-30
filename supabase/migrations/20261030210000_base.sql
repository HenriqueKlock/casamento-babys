-- Casamento Babys: convidado entra pelo código do QR (login anônimo), recebe um desafio sorteado e cumpre com uma foto.
-- Sorteio, troca e cumprimento só passam por funções no banco: o convidado não escolhe desafio nem posta foto solta.
-- Noivos e moderadores entram por e-mail e estão em app_admins (por e-mail, preenchida no banco ou pelo painel).

create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z0-9-]{6,40}$'),
  nome text not null check (char_length(nome) between 1 and 80),
  data date not null,
  aberto boolean not null default true,
  max_trocas int not null default 2 check (max_trocas between 0 and 10),
  max_desafios int not null default 3 check (max_desafios between 1 and 30),
  criado_em timestamptz not null default now()
);

create table public.app_admins (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  criado_em timestamptz not null default now()
);

create table public.convidados (
  id uuid primary key references auth.users on delete cascade,
  evento_id uuid not null references public.eventos on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 40),
  criado_em timestamptz not null default now()
);
create index on public.convidados (evento_id);

create table public.desafios (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos on delete cascade,
  texto text not null check (char_length(btrim(texto)) between 3 and 200),
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  unique (evento_id, texto)
);

create table public.sorteios (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos on delete cascade,
  convidado_id uuid not null references public.convidados on delete cascade,
  desafio_id uuid not null references public.desafios on delete cascade,
  status text not null default 'aberto' check (status in ('aberto', 'cumprido', 'trocado')),
  criado_em timestamptz not null default now(),
  fechado_em timestamptz
);
-- um desafio aberto por convidado
create unique index sorteios_um_aberto on public.sorteios (convidado_id) where status = 'aberto';
create index on public.sorteios (desafio_id);

create table public.fotos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos on delete cascade,
  sorteio_id uuid not null unique references public.sorteios on delete cascade,
  convidado_id uuid not null references public.convidados on delete cascade,
  desafio_id uuid not null references public.desafios on delete cascade,
  -- copiados no momento do envio para o mural e o telão não precisarem ler outras tabelas
  nome text not null,
  desafio_texto text not null,
  caminho text not null check (char_length(caminho) <= 200),
  miniatura text not null check (char_length(miniatura) <= 200),
  oculta boolean not null default false,
  criado_em timestamptz not null default now()
);
create index on public.fotos (evento_id, criado_em desc);
create index on public.fotos (convidado_id);
create index on public.fotos (desafio_id);

alter table public.eventos enable row level security;
alter table public.app_admins enable row level security;
alter table public.convidados enable row level security;
alter table public.desafios enable row level security;
alter table public.sorteios enable row level security;
alter table public.fotos enable row level security;

-- ninguém sem login lê ou grava nada
revoke all on public.eventos, public.app_admins, public.convidados, public.desafios, public.sorteios, public.fotos from anon;
-- convidado só lê; as escritas dele passam pelas funções abaixo
revoke insert, update, delete on public.convidados, public.sorteios from authenticated;

/* ---------- quem é quem ---------- */
create function public.sou_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.app_admins a where a.email = lower(auth.jwt() ->> 'email'));
$$;

create function public.meu_evento() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.evento_id from public.convidados c where c.id = auth.uid();
$$;

revoke execute on function public.sou_admin(), public.meu_evento() from public, anon;
grant execute on function public.sou_admin(), public.meu_evento() to authenticated;

/* ---------- regras de acesso ---------- */
create policy "eventos: participante e admin leem" on public.eventos for select to authenticated
  using (id = (select public.meu_evento()) or (select public.sou_admin()));
create policy "eventos: admin altera" on public.eventos for update to authenticated
  using ((select public.sou_admin())) with check ((select public.sou_admin()));

create policy "admins: admin lê" on public.app_admins for select to authenticated using ((select public.sou_admin()));
create policy "admins: admin inclui" on public.app_admins for insert to authenticated with check ((select public.sou_admin()));
create policy "admins: admin remove" on public.app_admins for delete to authenticated
  using ((select public.sou_admin()) and email <> lower(auth.jwt() ->> 'email'));

create policy "convidados: cada um se lê, admin lê todos" on public.convidados for select to authenticated
  using (id = (select auth.uid()) or (select public.sou_admin()));

-- a lista inteira é surpresa: o convidado só vê os desafios que sorteou
create policy "desafios: os sorteados e admin" on public.desafios for select to authenticated
  using ((select public.sou_admin())
         or exists (select 1 from public.sorteios s where s.desafio_id = desafios.id and s.convidado_id = (select auth.uid())));
create policy "desafios: admin inclui" on public.desafios for insert to authenticated with check ((select public.sou_admin()));
create policy "desafios: admin altera" on public.desafios for update to authenticated
  using ((select public.sou_admin())) with check ((select public.sou_admin()));

create policy "sorteios: cada um os seus, admin todos" on public.sorteios for select to authenticated
  using (convidado_id = (select auth.uid()) or (select public.sou_admin()));

create policy "fotos: mural do evento" on public.fotos for select to authenticated
  using ((evento_id = (select public.meu_evento()) and not oculta)
         or convidado_id = (select auth.uid())
         or (select public.sou_admin()));
create policy "fotos: admin oculta" on public.fotos for update to authenticated
  using ((select public.sou_admin())) with check ((select public.sou_admin()));
create policy "fotos: dono ou admin apaga" on public.fotos for delete to authenticated
  using (convidado_id = (select auth.uid()) or (select public.sou_admin()));
revoke insert on public.fotos from authenticated;
revoke update on public.fotos from authenticated;
grant update (oculta) on public.fotos to authenticated;

/* ---------- entrar, sortear, trocar, cumprir ---------- */
create function public.entrar(p_codigo text, p_nome text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ev public.eventos;
  v_nome text := btrim(coalesce(p_nome, ''));
begin
  if v_uid is null then raise exception 'sem_login'; end if;
  if char_length(v_nome) not between 1 and 40 then raise exception 'nome_invalido'; end if;
  select * into v_ev from public.eventos e where e.codigo = lower(btrim(p_codigo));
  if not found then raise exception 'codigo_invalido'; end if;
  if not v_ev.aberto then raise exception 'evento_fechado'; end if;
  insert into public.convidados (id, evento_id, nome) values (v_uid, v_ev.id, v_nome)
    on conflict (id) do update set nome = excluded.nome
    where public.convidados.evento_id = excluded.evento_id;
  if not found then raise exception 'outro_evento'; end if;
  return jsonb_build_object('evento_id', v_ev.id, 'evento', v_ev.nome);
end $$;

-- situação do convidado: desafio aberto, quantos já cumpriu, quantas trocas restam
create function public.estado() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_c public.convidados;
  v_ev public.eventos;
  v_aberto jsonb;
  v_feitos int;
  v_trocados int;
begin
  select * into v_c from public.convidados c where c.id = v_uid;
  if not found then return null; end if;
  select * into v_ev from public.eventos e where e.id = v_c.evento_id;
  select jsonb_build_object('id', s.id, 'desafio_id', d.id, 'texto', d.texto) into v_aberto
    from public.sorteios s join public.desafios d on d.id = s.desafio_id
    where s.convidado_id = v_uid and s.status = 'aberto';
  select count(*) filter (where status = 'cumprido'), count(*) filter (where status = 'trocado')
    into v_feitos, v_trocados from public.sorteios where convidado_id = v_uid;
  return jsonb_build_object(
    'nome', v_c.nome, 'evento_id', v_ev.id, 'evento', v_ev.nome, 'aberto', v_ev.aberto,
    'sorteio', v_aberto, 'feitos', v_feitos, 'max_desafios', v_ev.max_desafios,
    'trocas_restantes', greatest(0, v_ev.max_trocas - v_trocados));
end $$;

create function public.sortear() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_c public.convidados;
  v_ev public.eventos;
  v_feitos int;
  v_desafio uuid;
begin
  select * into v_c from public.convidados c where c.id = v_uid;
  if not found then raise exception 'sem_convidado'; end if;
  perform pg_advisory_xact_lock(hashtext('sortear:' || v_uid::text));
  select * into v_ev from public.eventos e where e.id = v_c.evento_id;
  if not v_ev.aberto then raise exception 'evento_fechado'; end if;
  if exists (select 1 from public.sorteios s where s.convidado_id = v_uid and s.status = 'aberto') then
    return public.estado();
  end if;
  select count(*) into v_feitos from public.sorteios s where s.convidado_id = v_uid and s.status = 'cumprido';
  if v_feitos >= v_ev.max_desafios then raise exception 'limite_desafios'; end if;
  -- equilibrado: entre os ativos que a pessoa ainda não teve, o que menos gente está fazendo ou fez
  select d.id into v_desafio
    from public.desafios d
    where d.evento_id = v_ev.id and d.ativo
      and not exists (select 1 from public.sorteios s where s.convidado_id = v_uid and s.desafio_id = d.id)
    order by (select count(*) from public.sorteios s2 where s2.desafio_id = d.id and s2.status <> 'trocado'), random()
    limit 1;
  if v_desafio is null then raise exception 'sem_desafios'; end if;
  insert into public.sorteios (evento_id, convidado_id, desafio_id) values (v_ev.id, v_uid, v_desafio);
  return public.estado();
end $$;

create function public.trocar(p_sorteio uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ev public.eventos;
  v_trocados int;
begin
  perform pg_advisory_xact_lock(hashtext('sortear:' || coalesce(v_uid::text, '')));
  select e.* into v_ev from public.sorteios s join public.eventos e on e.id = s.evento_id
    where s.id = p_sorteio and s.convidado_id = v_uid and s.status = 'aberto';
  if not found then raise exception 'sorteio_invalido'; end if;
  select count(*) into v_trocados from public.sorteios s where s.convidado_id = v_uid and s.status = 'trocado';
  if v_trocados >= v_ev.max_trocas then raise exception 'sem_trocas'; end if;
  update public.sorteios set status = 'trocado', fechado_em = now() where id = p_sorteio;
  return public.sortear();
end $$;

create function public.cumprir(p_sorteio uuid, p_caminho text, p_miniatura text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_s public.sorteios;
  v_ev public.eventos;
  v_pasta text;
  v_id uuid;
begin
  select * into v_s from public.sorteios s where s.id = p_sorteio and s.convidado_id = v_uid;
  if not found then raise exception 'sorteio_invalido'; end if;
  -- reenvio da fila do celular: devolve a foto que já entrou
  select f.id into v_id from public.fotos f where f.sorteio_id = p_sorteio;
  if found then return v_id; end if;
  if v_s.status <> 'aberto' then raise exception 'sorteio_invalido'; end if;
  select * into v_ev from public.eventos e where e.id = v_s.evento_id;
  if not v_ev.aberto then raise exception 'evento_fechado'; end if;
  v_pasta := v_ev.id::text || '/' || v_uid::text || '/';
  if p_caminho <> v_pasta || p_sorteio::text || '.jpg' or p_miniatura <> v_pasta || p_sorteio::text || '-mini.jpg' then
    raise exception 'caminho_invalido';
  end if;
  if (select count(*) from storage.objects o where o.bucket_id = 'fotos' and o.name in (p_caminho, p_miniatura)) <> 2 then
    raise exception 'arquivo_faltando';
  end if;
  insert into public.fotos (evento_id, sorteio_id, convidado_id, desafio_id, nome, desafio_texto, caminho, miniatura)
    select v_s.evento_id, v_s.id, v_uid, d.id, c.nome, d.texto, p_caminho, p_miniatura
    from public.desafios d, public.convidados c where d.id = v_s.desafio_id and c.id = v_uid
    returning id into v_id;
  update public.sorteios set status = 'cumprido', fechado_em = now() where id = p_sorteio;
  return v_id;
end $$;

revoke execute on function public.entrar(text, text), public.estado(), public.sortear(), public.trocar(uuid), public.cumprir(uuid, text, text) from public, anon;
grant execute on function public.entrar(text, text), public.estado(), public.sortear(), public.trocar(uuid), public.cumprir(uuid, text, text) to authenticated;

/* ---------- fotos no Storage ---------- */
-- público para o celular guardar em cache (caminhos são ids aleatórios e não há listagem);
-- só a própria pasta <evento>/<uid>/ recebe envio, e só com o evento aberto
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

create policy "fotos: convidado envia na própria pasta" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fotos'
    and (storage.foldername(name))[1] = (select public.meu_evento())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (select 1 from public.eventos e where e.id = (select public.meu_evento()) and e.aberto)
  );
create policy "fotos: dono lê os próprios arquivos" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "fotos: dono ou admin apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and ((storage.foldername(name))[2] = (select auth.uid())::text or (select public.sou_admin())));

/* ---------- tempo real: mural e telão ---------- */
alter publication supabase_realtime add table public.fotos;
