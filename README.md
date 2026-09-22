# NOVA — E-commerce & Landing Page Builder (static + Supabase)

A clean, minimalist, European-style e-commerce and landing page builder platform with a fully separated Arabic RTL admin dashboard. **Zero build step, zero server** — pure HTML/CSS/JS served as static files (GitHub Pages) backed by **Supabase** (PostgreSQL + Auth + Storage).

All `/api/*` calls made by the frontend are intercepted at runtime by `public/assets/js/api.js` (loaded through `nova-supabase.js`) and routed straight to Supabase with the publishable "anon" key — no secret ever reaches the browser.

## Quick start (local)

Serve the static tree with any static server, e.g. `npx serve` or `python -m http.server` from a folder containing `public/` and `admin/` at the same level (the site root). The storefront lives in `public/`, the admin at `/admin`.

| URL            | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `/`            | Public storefront (home / landing page)          |
| `/product.html?id=N` | Per-product landing page                   |
| `/cart.html`   | Cart & checkout demo                             |
| `/admin`       | Admin dashboard (Arabic, full RTL)               |

## Deploying to GitHub Pages

1. Push this repository to GitHub (default branch `main`).
2. In Settings → Pages, set **Source → GitHub Actions**.
3. Push a commit; `.github/workflows/pages.yml` assembles `public/*` into the site root plus `admin/` under `/admin` and deploys.

## Architecture

```
project-nova/
├── public/            # Storefront (site root on Pages)
│   ├── index.html / product.html / order.html / cart.html / insights.html / builder.html
│   └── assets/
│       ├── css/
│       └── js/
│           ├── nova-supabase.js   # Supabase client (anon key only) + storage helpers
│           ├── api.js             # fetch/XHR shim: /api/products, /api/orders, /api/settings, /api/i18n, /api/upload, /api/auth/*
│           └── store / product / order / cart / currency / checkout-i18n / insights / builder .js
├── admin/             # Admin dashboard (SPA, RTL Arabic), deployed at /admin
│   ├── index.html / login.html / product-editor.html
│   └── assets/        # admin.js, editor.js, login.js, admin.css, editor.css
└── supabase/
    └── schema.sql     # Tables, RLS, guest-order RPC (guest_upsert_order), receipt view, storage bucket
```

## Supabase backend

- **Tables** (`schema.sql`): `products(id, data jsonb)`, `orders(id, sid, status, product_id, qty, total, data jsonb)`, `settings(key, value jsonb)`, `nova_admin(id, email)`.
- **Row-Level Security**: everyone may read `products` + `settings`; guests may only insert/update **their own** checkout row (via the `sid` session token and the SECURITY DEFINER RPC `guest_upsert_order`) and read a safe, PII-free receipt (`v_order_receipt`); full CRUD on products/orders/settings/storage is reserved for admins logged in through Supabase Auth.
- **Storage**: public bucket `product-images`; uploads require an authenticated admin.

## API surface exposed by the shim

| Method | Endpoint              | Description                                     |
| ------ | --------------------- | ----------------------------------------------- |
| GET    | `/api/products`       | List all products (with landing content)        |
| GET    | `/api/products?id=N`  | Get a single product                            |
| POST   | `/api/products`       | Create/update a product (admin)                 |
| DELETE | `/api/products?id=N`  | Delete a product (admin)                        |
| GET    | `/api/orders`         | All orders (admin)                              |
| POST   | `/api/orders`         | Guest checkout: draft autosave & final submit (via RPC) |
| PUT    | `/api/orders`         | Spreadsheet batch-edit (admin)                  |
| GET/POST | `/api/settings`     | Store settings (public read / admin write)     |
| GET/POST | `/api/i18n`         | Checkout form translations (public read / admin write) |
| POST   | `/api/upload`         | Image upload to Storage (admin)                 |
| POST   | `/api/auth/login`, `/api/auth/me`, `/api/auth/status`, `/api/auth/logout` | Supabase Auth session |

## Features

### Storefront
- High-contrast minimalist hero, feature grid, product grid, showcase, testimonials, newsletter.
- Live catalog from Supabase (with a built-in fallback catalog).
- Cart with quantity controls and order summary.
- Per-product landing page (`/product.html?id=N`).
- Checkout (`/order.html`) in Spanish COD ("contra reembolso") style with Google-maps address picker; translations are editable from the admin.

### Product & landing-page management (`/admin#products`)
- Create a product (modal) or edit any field from `/admin/product-editor.html?id=N` (name, price, sale price, badge, stock, hue, description, features, headline, promo line, CTA, images, reviews, translations, and a "معروض على المتجر" switch) with a live preview.
- Products with `landing.active = false` are hidden from the storefront grid.

### Admin dashboard (`/admin`)
- Auth-guarded (email + password via Supabase Auth — first admin: admin@nova-store.com).
- Overview metrics, orders management (tabs, search, date/product filters, per-order detail modal), a spreadsheet "Excel" view with batch save, and settings (general / storefront).
- Arabic, RTL, responsive, no chart library (hand-drawn SVG).

## Tests

```bash
node --check public/assets/js/*.js admin/assets/js/*.js   # syntax check any JS file
```