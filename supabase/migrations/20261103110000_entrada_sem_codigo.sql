-- Endereço sem código (henriqueklock.github.io/casamento-babys): no esquenta abre a entrada do esquenta e deixa
-- entrar só com o nome; na festa continua exigindo o código do QR.

-- fase do evento sem código (só a fase: 'esquenta' ou 'festa')
create function public.fase_publica() returns text
language sql stable security definer set search_path = '' as $$
  select public.fase_de(e) from public.eventos e where e.aberto order by e.criado_em limit 1;
$$;
revoke execute on function public.fase_publica() from public;
grant execute on function public.fase_publica() to anon, authenticated;

create or replace function public.entrar(p_codigo text, p_nome text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ev public.eventos;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_codigo text := lower(btrim(coalesce(p_codigo, '')));
begin
  if v_uid is null then raise exception 'sem_login'; end if;
  if char_length(v_nome) not between 1 and 40 then raise exception 'nome_invalido'; end if;
  if v_codigo = '' then
    -- sem código: só no esquenta
    select * into v_ev from public.eventos e where e.aberto order by e.criado_em limit 1;
    if not found or public.fase_de(v_ev) <> 'esquenta' then raise exception 'codigo_invalido'; end if;
  else
    select * into v_ev from public.eventos e where e.codigo = v_codigo;
    if not found then raise exception 'codigo_invalido'; end if;
  end if;
  if not v_ev.aberto then raise exception 'evento_fechado'; end if;
  insert into public.convidados (id, evento_id, nome) values (v_uid, v_ev.id, v_nome)
    on conflict (id) do update set nome = excluded.nome
    where public.convidados.evento_id = excluded.evento_id;
  if not found then raise exception 'outro_evento'; end if;
  return jsonb_build_object('evento_id', v_ev.id, 'evento', v_ev.nome);
end $$;
