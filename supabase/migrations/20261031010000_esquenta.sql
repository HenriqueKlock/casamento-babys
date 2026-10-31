-- Esquenta: antes do casamento o convidado compartilha momentos (foto e/ou recado, com tema sugerido) que vão
-- direto para o mural. No dia vira Festa: os desafios começam e o esquenta fecha.
-- A virada é manual no painel ou automática a partir de festa_a_partir.

alter table public.eventos
  add column fase text not null default 'esquenta' check (fase in ('esquenta', 'festa')),
  add column festa_a_partir timestamptz,
  add column max_fotos_esquenta int not null default 3 check (max_fotos_esquenta between 0 and 20),
  add column max_recados int not null default 3 check (max_recados between 0 and 20),
  add column temas text[] not null default array[
    'Uma foto antiga com os noivos',
    'De onde você vem para o casamento',
    'O look em construção',
    'Um brinde aos noivos',
    'Contagem regressiva: o que você está preparando'
  ] check (array_length(temas, 1) is null or array_length(temas, 1) <= 20),
  -- o que o telão mostra: os dois, só o esquenta ou só os desafios
  add column telao text not null default 'ambos' check (telao in ('ambos', 'esquenta', 'festa'));

-- post do esquenta não tem sorteio nem desafio; recado pode vir sem foto
alter table public.fotos
  add column tipo text not null default 'desafio' check (tipo in ('desafio', 'esquenta')),
  add column tema text check (char_length(tema) <= 80),
  add column legenda text check (char_length(legenda) <= 280),
  alter column sorteio_id drop not null,
  alter column desafio_id drop not null,
  alter column desafio_texto drop not null,
  alter column caminho drop not null,
  alter column miniatura drop not null,
  add constraint fotos_tipo_coerente check (
    (tipo = 'desafio' and sorteio_id is not null and desafio_id is not null and desafio_texto is not null
       and caminho is not null and miniatura is not null)
    or
    (tipo = 'esquenta' and sorteio_id is null and desafio_id is null
       and (caminho is not null or legenda is not null) and (caminho is null) = (miniatura is null))
  );
create index on public.fotos (convidado_id, tipo);

/* ---------- fase em vigor ---------- */
create function public.fase_de(e public.eventos) returns text
language sql stable set search_path = '' as $$
  select case when e.fase = 'festa' or (e.festa_a_partir is not null and now() >= e.festa_a_partir) then 'festa' else 'esquenta' end;
$$;

-- a tela de entrada muda o texto conforme a fase, antes do login; só devolve a fase (ou nulo para código inventado)
create function public.fase_do_evento(p_codigo text) returns text
language sql stable security definer set search_path = '' as $$
  select public.fase_de(e) from public.eventos e where e.codigo = lower(btrim(p_codigo));
$$;
revoke execute on function public.fase_de(public.eventos) from public, anon, authenticated;
revoke execute on function public.fase_do_evento(text) from public;
grant execute on function public.fase_do_evento(text) to anon, authenticated;

/* ---------- estado do convidado, agora com a fase e o esquenta ---------- */
create or replace function public.estado() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_c public.convidados;
  v_ev public.eventos;
  v_aberto jsonb;
  v_feitos int;
  v_trocados int;
  v_fotos_esq int;
  v_recados int;
begin
  select * into v_c from public.convidados c where c.id = v_uid;
  if not found then return null; end if;
  select * into v_ev from public.eventos e where e.id = v_c.evento_id;
  select jsonb_build_object('id', s.id, 'desafio_id', d.id, 'texto', d.texto) into v_aberto
    from public.sorteios s join public.desafios d on d.id = s.desafio_id
    where s.convidado_id = v_uid and s.status = 'aberto';
  select count(*) filter (where status = 'cumprido'), count(*) filter (where status = 'trocado')
    into v_feitos, v_trocados from public.sorteios where convidado_id = v_uid;
  select count(*) filter (where caminho is not null), count(*) filter (where caminho is null)
    into v_fotos_esq, v_recados from public.fotos where convidado_id = v_uid and tipo = 'esquenta';
  return jsonb_build_object(
    'nome', v_c.nome, 'evento_id', v_ev.id, 'evento', v_ev.nome, 'data', v_ev.data, 'aberto', v_ev.aberto,
    'fase', public.fase_de(v_ev),
    'sorteio', v_aberto, 'feitos', v_feitos, 'max_desafios', v_ev.max_desafios,
    'trocas_restantes', greatest(0, v_ev.max_trocas - v_trocados),
    'temas', to_jsonb(v_ev.temas),
    'fotos_esquenta', v_fotos_esq, 'max_fotos_esquenta', v_ev.max_fotos_esquenta,
    'recados', v_recados, 'max_recados', v_ev.max_recados);
end $$;

/* ---------- desafios só na festa ---------- */
create or replace function public.sortear() returns jsonb
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
  if public.fase_de(v_ev) <> 'festa' then raise exception 'fase_esquenta'; end if;
  if exists (select 1 from public.sorteios s where s.convidado_id = v_uid and s.status = 'aberto') then
    return public.estado();
  end if;
  select count(*) into v_feitos from public.sorteios s where s.convidado_id = v_uid and s.status = 'cumprido';
  if v_feitos >= v_ev.max_desafios then raise exception 'limite_desafios'; end if;
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

/* ---------- compartilhar no esquenta ---------- */
-- p_id vem do celular (é o nome do arquivo), para a fila poder reenviar sem duplicar
create function public.compartilhar(p_id uuid, p_caminho text, p_miniatura text, p_tema text, p_legenda text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_c public.convidados;
  v_ev public.eventos;
  v_pasta text;
  v_legenda text := nullif(btrim(coalesce(p_legenda, '')), '');
  v_tema text := nullif(btrim(coalesce(p_tema, '')), '');
  v_n int;
begin
  select * into v_c from public.convidados c where c.id = v_uid;
  if not found then raise exception 'sem_convidado'; end if;
  perform pg_advisory_xact_lock(hashtext('esquenta:' || v_uid::text));
  -- reenvio da fila do celular
  if exists (select 1 from public.fotos f where f.id = p_id and f.convidado_id = v_uid) then return p_id; end if;
  select * into v_ev from public.eventos e where e.id = v_c.evento_id;
  if not v_ev.aberto then raise exception 'evento_fechado'; end if;
  if public.fase_de(v_ev) <> 'esquenta' then raise exception 'esquenta_encerrado'; end if;
  if v_legenda is not null and char_length(v_legenda) > 280 then raise exception 'recado_longo'; end if;
  if v_tema is not null and not (v_tema = any (v_ev.temas)) then raise exception 'tema_invalido'; end if;

  if p_caminho is not null or p_miniatura is not null then
    v_pasta := v_ev.id::text || '/' || v_uid::text || '/';
    if p_caminho is distinct from v_pasta || p_id::text || '.jpg' or p_miniatura is distinct from v_pasta || p_id::text || '-mini.jpg' then
      raise exception 'caminho_invalido';
    end if;
    select count(*) into v_n from public.fotos f where f.convidado_id = v_uid and f.tipo = 'esquenta' and f.caminho is not null;
    if v_n >= v_ev.max_fotos_esquenta then raise exception 'limite_fotos_esquenta'; end if;
    if (select count(*) from storage.objects o where o.bucket_id = 'fotos' and o.name in (p_caminho, p_miniatura)) <> 2 then
      raise exception 'arquivo_faltando';
    end if;
  else
    if v_legenda is null then raise exception 'recado_vazio'; end if;
    select count(*) into v_n from public.fotos f where f.convidado_id = v_uid and f.tipo = 'esquenta' and f.caminho is null;
    if v_n >= v_ev.max_recados then raise exception 'limite_recados'; end if;
  end if;

  insert into public.fotos (id, evento_id, convidado_id, tipo, nome, tema, legenda, caminho, miniatura)
    values (p_id, v_ev.id, v_uid, 'esquenta', v_c.nome, v_tema, v_legenda, p_caminho, p_miniatura);
  return p_id;
end $$;
revoke execute on function public.compartilhar(uuid, text, text, text, text) from public, anon;
grant execute on function public.compartilhar(uuid, text, text, text, text) to authenticated;

-- o painel lê a fase em vigor (a virada automática não muda a coluna)
create function public.fase_atual() returns text
language sql stable security definer set search_path = '' as $$
  select public.fase_de(e) from public.eventos e
  where e.id = coalesce(public.meu_evento(), (select id from public.eventos order by criado_em limit 1))
    and (public.meu_evento() is not null or public.sou_admin());
$$;
revoke execute on function public.fase_atual() from public, anon;
grant execute on function public.fase_atual() to authenticated;
