-- Trigger functions live in `public`, which PostgREST exposes as RPC. They are
-- only ever meant to fire from triggers, so no API role should be able to call
-- them — handle_new_user especially, since it is SECURITY DEFINER.

revoke execute on function public.handle_new_user()  from anon, authenticated, public;
revoke execute on function public.touch_updated_at() from anon, authenticated, public;
