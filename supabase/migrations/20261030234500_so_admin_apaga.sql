-- Foto no mural fica: o convidado não apaga nem a própria (nem a linha, nem o arquivo).
-- Só noivos e moderadores ocultam (reversível, pelo painel) ou apagam.
drop policy "fotos: dono ou admin apaga" on public.fotos;
create policy "fotos: admin apaga" on public.fotos for delete to authenticated using ((select public.sou_admin()));

drop policy "fotos: dono ou admin apaga" on storage.objects;
create policy "fotos: admin apaga arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (select public.sou_admin()));
