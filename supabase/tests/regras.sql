-- Regras do jogo e isolamento entre convidados. Rodar no SQL do Supabase: tudo acontece dentro de um bloco
-- que termina com um erro de propósito ("TESTES OK"), o que desfaz o que foi criado. Qualquer outro erro = falha.
do $$
declare
  v_ev uuid; v_codigo text;
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  r jsonb; s1 uuid; s_final uuid; d_final uuid; f uuid; f2 uuid; n int; v_admin text;
begin
  select id, codigo into v_ev, v_codigo from public.eventos order by criado_em limit 1;
  -- lido antes de trocar de papel: para o convidado a tabela de admins é invisível
  select email into v_admin from public.app_admins limit 1;
  update public.eventos set aberto = true, max_trocas = 2, max_desafios = 3 where id = v_ev;
  insert into auth.users (id, aud, role, is_anonymous) values (a, 'authenticated', 'authenticated', true), (b, 'authenticated', 'authenticated', true);

  -- ===== convidado A =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  execute 'set local role authenticated';

  begin perform public.entrar('codigo-errado', 'Ana'); raise exception 'FALHOU: código errado entrou';
  exception when others then if sqlerrm <> 'codigo_invalido' then raise; end if; end;
  begin perform public.entrar(v_codigo, '   '); raise exception 'FALHOU: nome vazio entrou';
  exception when others then if sqlerrm <> 'nome_invalido' then raise; end if; end;
  perform public.entrar(v_codigo, 'Ana');

  select count(*) into n from public.desafios;
  if n <> 0 then raise exception 'FALHOU: convidado vê % desafios antes de sortear', n; end if;

  r := public.sortear();
  s1 := (r -> 'sorteio' ->> 'id')::uuid;
  if s1 is null or (r ->> 'trocas_restantes')::int <> 2 then raise exception 'FALHOU: sortear devolveu %', r; end if;
  if (public.sortear() -> 'sorteio' ->> 'id')::uuid <> s1 then raise exception 'FALHOU: sortear de novo trocou o desafio'; end if;
  select count(*) into n from public.desafios;
  if n <> 1 then raise exception 'FALHOU: convidado vê % desafios com 1 sorteado', n; end if;

  r := public.trocar(s1);
  r := public.trocar((r -> 'sorteio' ->> 'id')::uuid);
  if (r ->> 'trocas_restantes')::int <> 0 then raise exception 'FALHOU: trocas restantes %', r; end if;
  s_final := (r -> 'sorteio' ->> 'id')::uuid;
  d_final := (r -> 'sorteio' ->> 'desafio_id')::uuid;
  begin perform public.trocar(s_final); raise exception 'FALHOU: trocou além do limite';
  exception when others then if sqlerrm <> 'sem_trocas' then raise; end if; end;

  begin insert into public.sorteios (evento_id, convidado_id, desafio_id) values (v_ev, a, d_final); raise exception 'FALHOU: inseriu sorteio direto';
  exception when insufficient_privilege then null; end;
  begin insert into public.fotos (evento_id, sorteio_id, convidado_id, desafio_id, nome, desafio_texto, caminho, miniatura)
    values (v_ev, s_final, a, d_final, 'x', 'x', 'x', 'x'); raise exception 'FALHOU: inseriu foto direto';
  exception when insufficient_privilege then null; end;

  begin perform public.cumprir(s_final, v_ev || '/' || b || '/' || s_final || '.jpg', v_ev || '/' || b || '/' || s_final || '-mini.jpg');
    raise exception 'FALHOU: aceitou caminho de outra pessoa';
  exception when others then if sqlerrm <> 'caminho_invalido' then raise; end if; end;
  begin perform public.cumprir(s_final, v_ev || '/' || a || '/' || s_final || '.jpg', v_ev || '/' || a || '/' || s_final || '-mini.jpg');
    raise exception 'FALHOU: cumpriu sem arquivo';
  exception when others then if sqlerrm <> 'arquivo_faltando' then raise; end if; end;

  execute 'reset role';
  insert into storage.objects (bucket_id, name) values
    ('fotos', v_ev || '/' || a || '/' || s_final || '.jpg'), ('fotos', v_ev || '/' || a || '/' || s_final || '-mini.jpg');
  execute 'set local role authenticated';

  f := public.cumprir(s_final, v_ev || '/' || a || '/' || s_final || '.jpg', v_ev || '/' || a || '/' || s_final || '-mini.jpg');
  f2 := public.cumprir(s_final, v_ev || '/' || a || '/' || s_final || '.jpg', v_ev || '/' || a || '/' || s_final || '-mini.jpg');
  if f is null or f <> f2 then raise exception 'FALHOU: reenvio da fila criou outra foto'; end if;
  delete from public.fotos where id = f;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: dono apagou a própria foto do mural'; end if;
  r := public.estado();
  if (r ->> 'feitos')::int <> 1 or r -> 'sorteio' <> 'null'::jsonb then raise exception 'FALHOU: estado depois de cumprir %', r; end if;

  -- ===== convidado B =====
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  perform public.entrar(v_codigo, 'Bia');
  -- só a foto criada aqui: o evento pode já ter fotos de testes reais
  select count(*) into n from public.fotos where id = f;
  if n <> 1 then raise exception 'FALHOU: B não vê a foto de A no mural'; end if;
  update public.fotos set oculta = true where id = f;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: B ocultou foto de A'; end if;
  delete from public.fotos where id = f;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: B apagou foto de A'; end if;
  select count(*) into n from public.convidados;
  if n <> 1 then raise exception 'FALHOU: B vê % convidados', n; end if;
  select count(*) into n from public.sorteios;
  if n <> 0 then raise exception 'FALHOU: B vê sorteios de A'; end if;
  r := public.sortear();
  if (r -> 'sorteio' ->> 'desafio_id')::uuid = d_final then raise exception 'FALHOU: sorteio não equilibrou (repetiu o já cumprido)'; end if;

  -- ===== admin oculta =====
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'is_anonymous', false,
    'email', v_admin)::text, true);
  update public.fotos set oculta = true where id = f;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHOU: admin não ocultou'; end if;
  select count(*) into n from public.desafios;
  if n < 19 then raise exception 'FALHOU: admin vê só % desafios', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  select count(*) into n from public.fotos where id = f;
  if n <> 0 then raise exception 'FALHOU: foto oculta continua no mural de B'; end if;
  begin update public.fotos set oculta = false where id = f; exception when others then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  select count(*) into n from public.fotos where id = f;
  if n <> 1 then raise exception 'FALHOU: A não vê a própria foto oculta'; end if;

  -- convidado anônimo com e-mail no token não vira admin
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'is_anonymous', true,
    'email', v_admin)::text, true);
  if public.sou_admin() then raise exception 'FALHOU: anônimo virou admin'; end if;

  -- ===== limites e evento fechado =====
  execute 'reset role';
  update public.eventos set max_desafios = 1 where id = v_ev;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  begin perform public.sortear(); raise exception 'FALHOU: passou do limite de desafios';
  exception when others then if sqlerrm <> 'limite_desafios' then raise; end if; end;

  execute 'reset role';
  update public.eventos set aberto = false, max_desafios = 3 where id = v_ev;
  execute 'set local role authenticated';
  begin perform public.entrar(v_codigo, 'Ana'); raise exception 'FALHOU: entrou com evento fechado';
  exception when others then if sqlerrm <> 'evento_fechado' then raise; end if; end;
  begin perform public.sortear(); raise exception 'FALHOU: sorteou com evento fechado';
  exception when others then if sqlerrm <> 'evento_fechado' then raise; end if; end;

  -- ===== sem login =====
  execute 'reset role';
  execute 'set local role anon';
  begin select count(*) into n from public.fotos; raise exception 'FALHOU: anônimo leu fotos';
  exception when insufficient_privilege then null; end;
  begin perform public.sortear(); raise exception 'FALHOU: anônimo chamou sortear';
  exception when insufficient_privilege then null; end;

  execute 'reset role';
  raise exception 'TESTES OK';
end $$;
