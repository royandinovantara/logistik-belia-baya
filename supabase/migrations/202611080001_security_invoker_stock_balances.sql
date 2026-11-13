-- BELIA-BAYA: make stock_balances obey the querying user's privileges and RLS.
-- PostgreSQL 15+ supports security_invoker on views (project currently PostgreSQL 17).
-- This migration does not modify or delete inventory data.
ALTER VIEW public.stock_balances SET (security_invoker = true);

-- Authenticated application users need SELECT on the view and its source tables.
-- Row-level policies on items and inventory_movements continue to apply.
GRANT SELECT ON public.stock_balances TO authenticated;
GRANT SELECT ON public.items, public.inventory_movements TO authenticated;

COMMENT ON VIEW public.stock_balances IS
  'Stock balance view using security_invoker so querying user privileges and RLS policies apply.';
