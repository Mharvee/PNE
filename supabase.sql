-- Run in Supabase: SQL Editor > New query
create extension if not exists pgcrypto;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  image text,
  category text,
  in_stock boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  email text not null,
  phone text not null,
  address text not null,
  total_amount numeric(12,2) not null,
  payment_reference text not null unique,
  payment_status text not null default 'pending',
  order_status text not null default 'processing',
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  quantity integer not null check (quantity > 0),
  price numeric(12,2) not null  -- price at time of purchase
);

-- Security: public can only READ products. Orders are written by the server (service-role key bypasses RLS).
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
create policy "Public can read products" on products for select using (true);

-- Placeholder products (edit/delete freely)
insert into products (name, description, price, image, category, in_stock) values
('Sample Product 1', 'Replace with your product description.', 5000, '/images/img1.jpeg', 'General', true),
('Sample Product 2', 'Replace with your product description.', 7500, '/images/img2.jpeg', 'General', true),
('Sample Product 3', 'Replace with your product description.', 10000, '/images/img3.jpeg', 'General', false);
