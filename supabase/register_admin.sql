-- =========================================================
-- NOVA — Register a Supabase Auth user as a store admin
--
-- The products/settings/storage policies all check
-- public.is_nova_admin(), which verifies auth.uid() against
-- this table. A signed-in user can only write/upload once
-- their Auth user id exists here AND their email is confirmed.
--
-- Replace the UUID/email below with your admin's Auth user id.
-- To find it: supabase.com → Authentication → Users → the user's
-- UUID. Or run:  select id, email from auth.users;
-- =========================================================

INSERT INTO public.nova_admin (id, email, name)
VALUES (
  'ffbe1d92-a3c2-44fa-9f95-3b0529ecbeaa',  -- your Auth user id
  'yac200508@gmail.com',                  -- sign-in email
  'NOVA Admin'
)
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name  = EXCLUDED.name;

-- Verify the enrollment (must return t):
-- select public.is_nova_admin();