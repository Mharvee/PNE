-- Peace Nature Empire - per-product sale (additive, non-destructive migration)
--
-- Run in: Supabase Dashboard > SQL Editor > New query.
-- Apply to a STAGING / test Supabase project first if you have one.
--
-- What it does:
--   * adds 2 nullable-safe columns to public.products
--   * every existing product gets sale_active = false (NOT on sale) and keeps its
--     original price, stock, image, description and id untouched
--   * adds CHECK constraints so the database itself rejects invalid discounts
--
-- What it does NOT do:
--   * does not modify, drop or rewrite any existing column or row value
--   * does not touch Row Level Security or policies. The storefront keeps reading
--     products through the existing public SELECT policy; writes still happen only
--     through your authenticated admin API (service-role key).
--   * safe to run more than once (idempotent)

begin;

-- 1. Columns ---------------------------------------------------------------
alter table public.products
  add column if not exists sale_active     boolean not null default false,
  add column if not exists sale_percentage integer;

-- 2. Constraints (guarded so re-running does not fail) ------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_sale_percentage_range'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_sale_percentage_range
      check (sale_percentage is null or (sale_percentage between 1 and 99));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'products_sale_requires_percentage'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_sale_requires_percentage
      check (sale_active = false or sale_percentage is not null);
  end if;
end
$$;

commit;

-- 3. Verification (read-only). Expect: sale_on = 0 and every price unchanged. ---
-- select count(*) as total_products,
--        count(*) filter (where sale_active) as sale_on
-- from public.products;
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'products'
--   and column_name in ('sale_active', 'sale_percentage');
--
-- Optional: confirm nobody except your server can write to products.
-- Expected: only a SELECT policy (e.g. "Public can read products").
-- select policyname, cmd, roles from pg_policies where tablename = 'products';

-- ROLLBACK (only if you ever need to remove the feature; original prices are
-- never changed by this feature, so no price data is lost):
-- alter table public.products drop constraint if exists products_sale_requires_percentage;
-- alter table public.products drop constraint if exists products_sale_percentage_range;
-- alter table public.products drop column if exists sale_percentage;
-- alter table public.products drop column if exists sale_active;
