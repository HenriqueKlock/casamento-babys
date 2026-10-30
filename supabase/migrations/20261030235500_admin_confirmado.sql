-- Admin só com conta de e-mail confirmado (criadas no painel do Supabase com "Auto Confirm User").
-- Impede que alguém crie pelo cadastro público uma conta com o e-mail de um moderador e vire admin.
create or replace function public.sou_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.app_admins a where a.email = lower(auth.jwt() ->> 'email'))
     and exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null
                   and lower(u.email) = lower(auth.jwt() ->> 'email'));
$$;
