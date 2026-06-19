-- ReturnGuard — InsForge (PostgreSQL) schema
-- Apply with: insforge db query "$(cat db/schema.sql)"

-- Decision tickets: one row per return request (read by the ops dashboard).
CREATE TABLE IF NOT EXISTS cases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             text NOT NULL,
  reason               text,
  verdict              text CHECK (verdict IN ('auto_approve','escalate','deny')),  -- AI recommendation
  fraud_score          numeric,
  variant_match        boolean,           -- Nebius vision: photo matches the ordered product
  resale_flag          boolean,           -- Apify reverse-image: photo found on a resale marketplace
  resale_domains       jsonb DEFAULT '[]'::jsonb,
  review_corroboration numeric,
  reasons              jsonb DEFAULT '[]'::jsonb,
  photo_url            text,
  listing_url          text,
  -- ticket workflow
  status               text DEFAULT 'resolved',   -- 'pending' (awaiting admin) | 'resolved'
  final_decision       text,                       -- 'approved' | 'denied' | null
  resolved_by          text,                       -- 'ReturnGuard AI' or an admin name
  resolved_at          timestamptz,
  admin_note           text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Customer-uploaded photo linked to an order (looked up when verifyReturn fires).
CREATE TABLE IF NOT EXISTS uploads (
  order_id   text PRIMARY KEY,
  photo_url  text NOT NULL,
  photo_key  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Latest return-form context (order_id + reason) captured when a call starts, so the
-- verdict uses the form's order details rather than the live voice transcript.
CREATE TABLE IF NOT EXISTS demo_intent (
  id         text PRIMARY KEY DEFAULT 'current',
  order_id   text,
  reason     text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Order reference: what each order contained + customer/purchase details for the dashboard.
CREATE TABLE IF NOT EXISTS orders (
  order_id          text PRIMARY KEY,
  product_image_url text,           -- ordered product image (vision compares against this)
  variant_label     text,
  customer_name     text,
  customer_email    text,
  product_name      text,
  price             numeric,
  currency          text DEFAULT 'USD',
  order_date        date,
  payment_last4     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
