-- The event trigger invokes this function with its owner privileges; API roles
-- never need to call it directly. Removing default EXECUTE prevents it from
-- becoming an exposed SECURITY DEFINER RPC endpoint.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
