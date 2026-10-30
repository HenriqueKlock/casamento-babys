-- Aviso do Supabase: índice na FK de sorteios.evento_id.
create index if not exists sorteios_evento_id_idx on public.sorteios (evento_id);
