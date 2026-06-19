-- ReturnGuard — InsForge (PostgreSQL) schema
-- Apply with: insforge db query "$(cat db/schema.sql)"

-- Decision tickets: one row per resolved return request (read by the ops dashboard).
CREATE TABLE IF NOT EXISTS cases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             text NOT NULL,
  reason               text,
  verdict              text CHECK (verdict IN ('auto_approve','escalate','deny')),
  fraud_score          numeric,
  variant_match        boolean,           -- Nebius vision: photo matches the ordered product
  resale_flag          boolean,           -- Apify reverse-image: photo found on a resale marketplace
  resale_domains       jsonb DEFAULT '[]'::jsonb,
  review_corroboration numeric,
  reasons              jsonb DEFAULT '[]'::jsonb,
  photo_url            text,
  listing_url          text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Customer-uploaded photo linked to an order (looked up when verifyReturn fires).
CREATE TABLE IF NOT EXISTS uploads (
  order_id   text PRIMARY KEY,
  photo_url  text NOT NULL,
  photo_key  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Reference of what each order actually contained (vision compares against this).
CREATE TABLE IF NOT EXISTS orders (
  order_id          text PRIMARY KEY,
  product_image_url text,
  variant_label     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
