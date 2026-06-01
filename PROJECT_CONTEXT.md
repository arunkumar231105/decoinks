# PROJECT_CONTEXT.md — Decoinks Printshop OS

> **Last updated:** 2026-05-21  
> **Purpose:** Complete project knowledge document for onboarding AI tools and new developers.  
> **Status:** Active development — MVP feature-complete, continuing enhancement.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Folder & File Structure](#3-folder--file-structure)
4. [Database Schema](#4-database-schema)
5. [Backend API](#5-backend-api)
6. [Frontend Applications](#6-frontend-applications)
7. [Key Features Implemented](#7-key-features-implemented)
8. [Known Issues / In-Progress Work](#8-known-issues--in-progress-work)
9. [Conventions & Patterns](#9-conventions--patterns)
10. [How to Run Locally](#10-how-to-run-locally)
11. [Deployment](#11-deployment)
12. [For AI Assistants Reading This Document](#12-for-ai-assistants-reading-this-document)

---

## 1. Project Overview

**Decoinks** is a full-stack Print Shop Operations System (POS/ERP) purpose-built for a custom printing business that handles apparel decoration, DTF (Direct-to-Film) transfers, and gangsheet printing. It is branded "Decoinks Printshop OS" and replaces manual order tracking with a structured, multi-module workflow system.

**The business problem it solves:**  
Printshops manage a complex pipeline: a lead comes in (via Instagram, WhatsApp, etc.), an artwork proof is created, a quotation is sent, an order is placed with production details (shirt sizes, gangsheet specs), a vendor purchase order is sent to the supplier, and finally the finished goods are shipped. Before Decoinks, all this was tracked in spreadsheets and chat apps. Decoinks provides a unified dashboard and end-to-end workflow from lead capture to delivery.

**Two user-facing applications exist:**
1. **Admin POS Frontend** (`decoinks-frontend`) — Used by the printshop's internal staff (Admin, Manager, Sales, Production, Viewer roles) to manage all operations: leads, quotes, orders, purchase orders, invoices, shipments, products, and artwork.
2. **Supplier Portal** (`customer-portal`) — A separate web app accessed by printing vendors/suppliers. They can view orders sent to them, download artworks, view their purchase orders, and submit production status updates. *(Note: the directory is named `customer-portal` for historical reasons but is functionally a supplier portal.)*

**Target users:** Small to medium US-based printshop businesses. The printshop owner/manager uses the admin panel; their vendors/suppliers use the portal.

**Current status:** MVP is production-ready and containerized. Core workflow (lead → quote → order → PO → ship) is fully functional. Recent work includes an ERP-grade PO redesign with line-item financial calculations, status history, and the supplier portal features.

---

## 2. Tech Stack

### Backend (`backend/`)

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20 (Alpine in Docker) |
| Framework | Express.js | 4.22.x |
| Language | JavaScript (CommonJS) | ES2022 |
| Database | PostgreSQL | 15 (Alpine in Docker) |
| DB Client | `pg` (node-postgres) | 8.20.x |
| ORM | **None** — raw SQL via `pg.Pool` | — |
| Caching | Redis via `ioredis` | 5.3.x |
| Auth | JWT via `jsonwebtoken` | 9.0.x |
| Password hashing | `bcryptjs` | 2.4.x |
| Input validation | `zod` | 3.25.x |
| File upload | `multer` | 1.4.x |
| Logging | `pino` + `pino-http` + `pino-pretty` | 9.x |
| HTTP security | `helmet` | 7.x |
| CORS | `cors` | 2.8.x |
| HTTP logging | `morgan` | 1.10.x |
| Google Drive | `googleapis` | 144.x |
| UUID | `uuid` | 9.x |
| Test runner | `jest` + `supertest` | 29.x + 7.x |

**No ORM** — all database queries are raw SQL executed via `pg.Pool`. This is intentional for performance and direct control.

### Admin Frontend (`decoinks-frontend/`)

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | 5.9.x |
| Framework | React | 18.3.x |
| Build tool | Vite | 5.4.x |
| Routing | React Router DOM | 6.30.x |
| Data fetching | TanStack React Query | 5.100.x |
| HTTP client | Axios | 1.15.x |
| State management | Zustand | 5.0.x |
| UI components | MUI (Material UI) | 9.0.x + Emotion |
| Icons | lucide-react | 1.14.x |
| Styling | Tailwind CSS | 3.4.x + tailwindcss-animate |
| Charts | Recharts | 3.8.x |
| Drag and drop | `@hello-pangea/dnd` | 18.x |
| Toast notifications | react-hot-toast | 2.6.x |
| Date utilities | date-fns | 4.1.x |
| Linting | ESLint 9 + typescript-eslint | 9.39.x |
| Formatting | Prettier | 3.8.x |
| CSS utilities | clsx + tailwind-merge | — |

### Supplier Portal (`customer-portal/`)

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | 5.5.x |
| Framework | React | 18.3.x |
| Build tool | Vite | 5.4.x |
| Routing | React Router DOM | 6.26.x |
| Data fetching | TanStack React Query | 5.51.x |
| HTTP client | Axios | 1.7.x |
| State management | Zustand | 4.5.x (with `persist`) |
| Icons | lucide-react | **0.395.x** (older — limited icon set) |
| Styling | Tailwind CSS | 3.4.x |
| Charts | Recharts | 2.12.x |
| Toast | react-hot-toast | 2.4.x |
| E2E testing | Playwright | 1.45.x |

> ⚠️ **Important:** The `customer-portal` uses lucide-react `^0.395.0` which is significantly older than the admin frontend's `^1.14.0`. Many newer icons (like `Send`, `ArrowRight`) are NOT available. Use only `Loader2`, `ArrowLeft`, `Download`, `ZoomIn`, `ZoomOut`, `Maximize2`, `RefreshCw`, `Bell`, `X`, `Check` and other basic icons.

### Database

- **PostgreSQL 15** (Alpine)
- No ORM — all queries are raw SQL
- Connection pooling via `pg.Pool` (max 20 connections, idle timeout 30s)
- UUID primary keys via `uuid-ossp` extension
- `updated_at` auto-maintenance via PostgreSQL trigger function `set_updated_at()`
- Advisory locks for race-free sequential number generation

### Docker Compose

Five services run in the `decoinks_net` bridge network:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `decoinks_postgres` | `postgres:15-alpine` | 5432 | Primary database, auto-init from `db/init.sql` + `db/portal_migration.sql` |
| `decoinks_redis` | `redis:7-alpine` | 6379 | Caching layer (connected via ioredis) |
| `decoinks_backend` | `possoftware-backend` | 8000 | Node.js REST API |
| `decoinks_frontend` | `possoftware-frontend` | 80 | Admin POS React app served via nginx |
| `decoinks_customer_portal` | `possoftware-customer_portal` | 3001 | Supplier portal React app via nginx |

The postgres service health-check gates backend startup. Both frontend containers are static builds served by nginx.

---

## 3. Folder & File Structure

```
POS Software/
├── .claude/                        # Claude Code AI assistant settings
│   ├── settings.json
│   └── settings.local.json
│
├── backend/                        # Node.js/Express REST API
│   ├── .env                        # Environment variables (secrets, URLs)
│   ├── Dockerfile.backend          # Multi-stage: base → dev/prod
│   ├── server.js                   # Entry point — creates HTTP server
│   ├── package.json
│   ├── migrations/                 # SQL migration files
│   │   ├── 001_setup.sql           # Full schema (idempotent, IF NOT EXISTS)
│   │   ├── 001_extensions_enums.sql
│   │   ├── 002_create_tables.sql
│   │   ├── 003_artwork_status.sql
│   │   └── run.js                  # Migration runner script
│   ├── scripts/
│   │   └── seed-admin.js           # Creates default admin user
│   ├── seeds/
│   │   └── seed.js                 # Sample data seed
│   ├── src/
│   │   ├── app.js                  # ★ Express app setup, all route mounts
│   │   ├── config/
│   │   │   ├── db.js               # ★ pg.Pool setup, query/getClient helpers
│   │   │   ├── redis.js            # ioredis client
│   │   │   └── googleDrive.js      # Google Drive integration config
│   │   ├── middleware/
│   │   │   ├── auth.js             # ★ verifyToken, requireRole, requireSupplier
│   │   │   ├── supplierAuth.js     # ★ JWT validation for supplier portal tokens
│   │   │   ├── customerAuth.js     # Legacy (superseded by supplierAuth.js)
│   │   │   ├── errorHandler.js     # Global Express error handler
│   │   │   ├── upload.js           # multer config for artworks + attachments
│   │   │   └── validate.js         # Zod schema validation middleware
│   │   ├── modules/                # Feature modules (each has routes/service/controller)
│   │   │   ├── auth/               # Login, logout, token refresh, setup
│   │   │   ├── users/              # User management + permissions
│   │   │   ├── suppliers/          # ★ Supplier CRUD + portal access mgmt
│   │   │   ├── customers/          # Legacy (dead code, superseded by suppliers/)
│   │   │   ├── leads/              # Lead tracking with Kanban + comments/attachments
│   │   │   ├── quotations/         # Quote creation with line items
│   │   │   ├── orders/             # ★ Orders (apparel/gangsheet/DTF) with portal integration
│   │   │   ├── invoices/           # Invoice generation and payment tracking
│   │   │   ├── purchase-orders/    # ★ ERP-grade PO with line items, status history
│   │   │   ├── shipments/          # Shipment records with tracking
│   │   │   ├── products/           # Product catalog
│   │   │   ├── artworks/           # Artwork library with file upload
│   │   │   ├── dashboard/          # Aggregated stats for admin dashboard
│   │   │   ├── supplier-portal/    # ★ Supplier-facing portal API
│   │   │   └── customer-portal/    # Legacy (dead code, superseded by supplier-portal/)
│   │   └── utils/
│   │       ├── counter.js          # ★ Sequential number generator (PO-2026-0001)
│   │       ├── logger.js           # pino logger instance
│   │       └── response.js         # ★ success/created/error/paginated helpers
│   ├── uploads/                    # Local file storage (volume-mounted)
│   │   ├── artworks/
│   │   └── attachments/
│   └── tests/
│       ├── setup.js                # Jest environment setup (loads .env)
│       ├── integration/
│       │   ├── helpers.js          # runMigrations, seedAdmin, truncateTestTables
│       │   ├── auth.test.js
│       │   ├── suppliers.test.js
│       │   ├── supplier-portal.test.js
│       │   ├── leads.test.js
│       │   ├── orders.test.js
│       │   └── customers.test.js   # Legacy test (old naming)
│       └── unit/
│           ├── counter.test.js
│           ├── response.test.js
│           └── validate.test.js
│
├── decoinks-frontend/              # Admin POS React app
│   ├── Dockerfile.frontend         # Vite build → nginx serve
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js          # Primary color: #0D9488 (teal), sidebar: #1F2937
│   ├── src/
│   │   ├── main.tsx                # React root, RouterProvider
│   │   ├── App.tsx                 # Root component with auth init
│   │   ├── router/
│   │   │   └── index.tsx           # ★ All routes defined here
│   │   ├── layouts/
│   │   │   ├── AppLayout.tsx       # ★ Sidebar + topbar shell
│   │   │   └── ProtectedRoute.tsx  # Auth guard
│   │   ├── pages/                  # One file per page/route
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── SetupPage.tsx       # First-run admin setup
│   │   │   ├── LeadBoardPage.tsx   # Kanban lead board
│   │   │   ├── AddLeadPage.tsx
│   │   │   ├── QuotesListPage.tsx
│   │   │   ├── NewQuotationPage.tsx
│   │   │   ├── WorkflowListPage.tsx # Generic list for orders/invoices/POs
│   │   │   ├── NewOrderPage.tsx    # ★ Complex order form (apparel/gangsheet/DTF)
│   │   │   ├── OrderDetailPage.tsx # ★ Full order view with status, items, portal
│   │   │   ├── NewInvoicePage.tsx
│   │   │   ├── NewPurchaseOrderPage.tsx # ★ ERP PO form (useReducer, line items)
│   │   │   ├── PurchaseOrderDetailPage.tsx # ★ PO detail with history timeline
│   │   │   ├── ShipmentsPage.tsx
│   │   │   ├── NewShipmentPage.tsx
│   │   │   ├── SuppliersPage.tsx
│   │   │   ├── NewSupplierPage.tsx
│   │   │   ├── SupplierDetailPage.tsx
│   │   │   ├── ProductsPage.tsx
│   │   │   ├── ArtworkLibraryPage.tsx
│   │   │   ├── ArtworkFormPage.tsx
│   │   │   ├── FulfillmentBoardPage.tsx
│   │   │   ├── BoardPage.tsx       # Generic Kanban board
│   │   │   ├── SettingsGeneralPage.tsx
│   │   │   ├── SettingsUsersPage.tsx
│   │   │   ├── UserEditPage.tsx
│   │   │   ├── AIAutomationsPage.tsx   # Placeholder/future
│   │   │   ├── SettingsWorkflowPage.tsx
│   │   │   ├── SettingsIntegrationsPage.tsx
│   │   │   ├── SettingsBillingPage.tsx
│   │   │   ├── PlaceholderPage.tsx # Used for routes not yet fully implemented
│   │   │   ├── CustomerDetailPage.tsx  # Legacy (dead code)
│   │   │   ├── CustomersPage.tsx       # Legacy (dead code)
│   │   │   └── NewCustomerPage.tsx     # Legacy (dead code)
│   │   ├── components/
│   │   │   ├── PortalAccessModal.tsx   # Modal to create/revoke supplier portal access
│   │   │   └── ui/                     # Shared UI primitives
│   │   ├── store/
│   │   │   └── authStore.ts        # ★ Zustand auth store (token in localStorage)
│   │   ├── services/
│   │   │   └── api.ts              # ★ Axios instance, token interceptor, 401 redirect
│   │   ├── hooks/
│   │   │   └── usePageMeta.ts      # Reads route `handle.title/subtitle`
│   │   ├── types/
│   │   │   └── auth.ts             # AuthUser, UserRole types
│   │   └── utils/
│   │       ├── cn.ts               # clsx + tailwind-merge utility
│   │       ├── actions.ts          # notReady() toast for unimplemented features
│   │       └── theme.ts
│   └── index.css                   # Global CSS + custom component classes
│
├── customer-portal/                # Supplier Portal React app
│   ├── Dockerfile.portal
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js          # accent: #3B82F6, sidebar: #0D182E
│   ├── e2e/
│   │   └── portal.spec.ts          # Playwright E2E tests
│   ├── playwright.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── router/
│       │   └── index.tsx           # ★ Portal routes
│       ├── store/
│       │   └── authStore.ts        # ★ Zustand (persisted as 'decoinks-supplier-portal-auth')
│       ├── services/
│       │   └── api.ts              # Axios, baseURL: /api/supplier, auto-logout on 401
│       ├── hooks/
│       │   ├── useSupplierAuth.ts  # Auth hook (active)
│       │   └── useCustomerAuth.ts  # Legacy (dead code, kept for TS compat)
│       ├── components/
│       │   ├── Layout.tsx          # Sidebar + TopBar shell
│       │   ├── Sidebar.tsx         # ★ Nav links + supplier name display
│       │   ├── TopBar.tsx          # ★ Notifications bell + supplier avatar
│       │   ├── OrderCard.tsx
│       │   ├── ArtworkThumb.tsx
│       │   └── StatusBadge.tsx
│       ├── pages/
│       │   ├── LoginPage.tsx       # "PRINTSHOP CPS – Supplier Portal"
│       │   ├── ChangePasswordPage.tsx  # Forced on first login
│       │   ├── DashboardPage.tsx
│       │   ├── OrdersPage.tsx
│       │   ├── OrderDetailPage.tsx     # ★ With "Submit Status Update" button
│       │   ├── PurchaseOrdersPage.tsx
│       │   ├── PurchaseOrderDetailPage.tsx
│       │   ├── ArtworksPage.tsx
│       │   ├── ProfilePage.tsx
│       │   └── ProductionStatusPage.tsx # ★ NEW: supplier submits production updates
│       ├── types/
│       │   └── index.ts            # Shared TypeScript interfaces
│       └── utils/
│           └── cn.ts
│
├── db/                             # Database initialization files
│   ├── init.sql                    # Full base schema (auto-mounted at Docker startup)
│   ├── portal_migration.sql        # Portal tables (auto-mounted at Docker startup)
│   ├── 002_supplier_rename.sql     # ★ Migration: customer→supplier rename + PO enhancements
│   └── 002_supplier_rename_down.sql # Rollback migration
│
└── docker-compose.yml              # ★ 5-service stack definition
```

---

## 4. Database Schema

The database runs PostgreSQL 15. All tables use `UUID` primary keys via `uuid_generate_v4()`. Sequential business numbers (PO-2026-0001, ORD-2026-0001, etc.) are generated by `backend/src/utils/counter.js` using `pg_advisory_xact_lock` for race safety.

### ENUMs

| ENUM Name | Values |
|-----------|--------|
| `user_role` | Admin, Manager, Sales, Production, Viewer |
| `supplier_status` | Active, Inactive |
| `lead_stage` | initiated, quotation, artwork, gangsheet, payment, confirmed |
| `lead_status` | New, Quotation, Pending, Payment Sent, Partial, Confirmed |
| `lead_source` | Facebook Messenger, WhatsApp, Instagram, Email, Walk-in, Phone |
| `quote_status` | Draft, Sent, Approved, Rejected, Expired |
| `order_type` | apparel, gangsheet, dtf |
| `order_status` | Draft, Confirmed, In Production, Ready to Ship, Shipped, Delivered, Cancelled |
| `payment_status` | Unpaid, Partial, Paid, Refunded |
| `payment_method` | cashapp, zelle, paypal, bank_transfer, cash, other |
| `payment_terms` | Due on Receipt, Net 15, Net 30, Net 60 |
| `invoice_status` | Draft, Sent, Paid, Overdue, Void |
| `po_status` | Draft, Sent, Received, Partial, Cancelled, **Pending Approval**, **Approved**, **Partially Received**, **Closed** *(bold = added in migration 002)* |
| `shipment_status` | Pending, Label Created, Picked Up, In Transit, Delivered, Exception |
| `product_type` | Apparel, DTF, Gangsheet, Embroidery, Other |
| `artwork_status` | Pending Review, Approved, Revision Needed, Rejected |

### Tables

---

#### `users`
Admin/staff accounts for the printshop.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default uuid |
| name | VARCHAR(120) | NOT NULL |
| email | VARCHAR(255) | NOT NULL UNIQUE |
| password | VARCHAR(255) | NOT NULL (bcrypt hash) |
| role | user_role | NOT NULL, default 'Sales' |
| avatar_url | TEXT | nullable |
| phone | VARCHAR(30) | nullable |
| is_active | BOOLEAN | NOT NULL, default true |
| last_login | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL (auto-trigger) |

Indexes: `email`, `role`, `is_active`

---

#### `suppliers` *(originally named `customers`, renamed in migration 002)*
Vendor/supplier accounts linked to orders and portal access.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| name | VARCHAR(150) | NOT NULL |
| email | VARCHAR(255) | nullable |
| phone | VARCHAR(30) | nullable |
| company | VARCHAR(150) | nullable |
| address_line1 | VARCHAR(200) | nullable |
| address_line2 | VARCHAR(200) | nullable |
| city | VARCHAR(80) | nullable |
| state | VARCHAR(80) | nullable |
| zip | VARCHAR(20) | nullable |
| country | VARCHAR(80) | default 'United States' |
| status | supplier_status | NOT NULL, default 'Active' |
| notes | TEXT | nullable |
| created_by | UUID | FK → users(id), SET NULL |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |
| deleted_at | TIMESTAMPTZ | nullable (soft delete) |

Indexes: `email`, `status`, partial `deleted_at IS NULL`

---

#### `leads`
Sales leads that flow through a Kanban pipeline.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| lead_number | VARCHAR(30) | NOT NULL UNIQUE (e.g. LEAD-2026-0001) |
| supplier_id | UUID | FK → suppliers(id), SET NULL |
| supplier_name | VARCHAR(150) | cached name text |
| source | lead_source | NOT NULL |
| description | TEXT | nullable |
| stage | lead_stage | NOT NULL, default 'initiated' |
| status | lead_status | NOT NULL, default 'New' |
| stage_position | INTEGER | NOT NULL, default 0 (Kanban card order) |
| assigned_to | UUID | FK → users(id), SET NULL |
| has_artwork | BOOLEAN | NOT NULL, default false |
| comment_count | INTEGER | NOT NULL, default 0 |
| attachment_count | INTEGER | NOT NULL, default 0 |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |
| deleted_at | TIMESTAMPTZ | nullable (soft delete) |

---

#### `lead_comments`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| lead_id | UUID | NOT NULL FK → leads(id) CASCADE |
| user_id | UUID | FK → users(id), SET NULL |
| body | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

---

#### `lead_attachments`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| lead_id | UUID | NOT NULL FK → leads(id) CASCADE |
| filename | VARCHAR(255) | NOT NULL |
| storage_path | TEXT | NOT NULL (relative path in uploads/) |
| mime_type | VARCHAR(100) | nullable |
| size_bytes | INTEGER | nullable |
| uploaded_by | UUID | FK → users(id), SET NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

---

#### `quotations`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| quote_number | VARCHAR(30) | NOT NULL UNIQUE (e.g. QT-2026-0001) |
| lead_id | UUID | FK → leads(id), SET NULL |
| supplier_id | UUID | FK → suppliers(id), SET NULL |
| status | quote_status | NOT NULL, default 'Draft' |
| valid_until | DATE | nullable |
| subtotal | NUMERIC(12,2) | NOT NULL, default 0 |
| discount_pct | NUMERIC(5,2) | default 0 |
| discount_amt | NUMERIC(12,2) | default 0 |
| tax_pct | NUMERIC(5,2) | default 0 |
| tax_amt | NUMERIC(12,2) | default 0 |
| total | NUMERIC(12,2) | NOT NULL, default 0 |
| notes | TEXT | nullable |
| created_by | UUID | FK → users(id), SET NULL |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL |

---

#### `quotation_items`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| quotation_id | UUID | NOT NULL FK → quotations(id) CASCADE |
| description | VARCHAR(255) | NOT NULL |
| qty | INTEGER | NOT NULL, default 1 |
| unit_price | NUMERIC(12,2) | NOT NULL, default 0 |
| amount | NUMERIC(12,2) | NOT NULL, default 0 |
| sort_order | INTEGER | default 0 |

---

#### `orders`
Production orders (3 types: apparel, gangsheet, DTF).

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| order_number | VARCHAR(30) | NOT NULL UNIQUE (e.g. ORD-2026-0001) |
| quotation_id | UUID | FK → quotations(id), SET NULL |
| supplier_id | UUID | FK → suppliers(id), SET NULL |
| order_type | order_type | NOT NULL |
| status | order_status | NOT NULL, default 'Draft' |
| payment_status | payment_status | NOT NULL, default 'Unpaid' |
| payment_method | payment_method | nullable |
| payment_terms | payment_terms | default 'Due on Receipt' |
| currency | VARCHAR(3) | default 'USD' |
| order_date | DATE | NOT NULL, default CURRENT_DATE |
| due_date | DATE | nullable |
| rush_services | NUMERIC(12,2) | default 0 |
| shipping_charges | NUMERIC(12,2) | default 0 |
| subtotal | NUMERIC(12,2) | NOT NULL, default 0 |
| discount_pct | NUMERIC(5,2) | default 0 |
| discount_amt | NUMERIC(12,2) | default 0 |
| tax_pct | NUMERIC(5,2) | default 7 |
| tax_amt | NUMERIC(12,2) | default 0 |
| total | NUMERIC(12,2) | NOT NULL, default 0 |
| notes | TEXT | nullable |
| shipping_name | VARCHAR(150) | nullable |
| shipping_address | TEXT | nullable |
| contact_name | VARCHAR(150) | nullable |
| contact_email | VARCHAR(255) | nullable |
| contact_phone | VARCHAR(30) | nullable |
| assigned_to | UUID | FK → users(id), SET NULL |
| created_by | UUID | FK → users(id), SET NULL |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL |
| deleted_at | TIMESTAMPTZ | nullable (soft delete) |

---

#### `order_items_apparel`
| Column | Type |
|--------|------|
| id | UUID PK |
| order_id | UUID NOT NULL FK → orders(id) CASCADE |
| item | VARCHAR(100) NOT NULL |
| color | VARCHAR(50) nullable |
| size | VARCHAR(20) nullable |
| qty | INTEGER NOT NULL |
| artwork_no | VARCHAR(50) nullable |
| artwork_size | VARCHAR(50) nullable |
| unit_price | NUMERIC(12,2) NOT NULL |
| amount | NUMERIC(12,2) NOT NULL |
| front_image | TEXT nullable (URL) |
| back_image | TEXT nullable (URL) |
| sort_order | INTEGER |

---

#### `order_items_gangsheet`
| Column | Type |
|--------|------|
| id | UUID PK |
| order_id | UUID NOT NULL FK → orders(id) CASCADE |
| size | VARCHAR(50) NOT NULL (e.g. "22\"x60\"") |
| no_artworks | INTEGER NOT NULL |
| qty | INTEGER NOT NULL |
| price_per_sheet | NUMERIC(12,2) NOT NULL |
| amount | NUMERIC(12,2) NOT NULL |
| front_image | TEXT nullable |
| sort_order | INTEGER |

---

#### `order_items_dtf`
| Column | Type |
|--------|------|
| id | UUID PK |
| order_id | UUID NOT NULL FK → orders(id) CASCADE |
| artwork_name | VARCHAR(150) NOT NULL |
| size | VARCHAR(50) nullable |
| qty | INTEGER NOT NULL |
| unit_price | NUMERIC(12,2) NOT NULL |
| amount | NUMERIC(12,2) NOT NULL |
| artwork_image | TEXT nullable |
| sort_order | INTEGER |

---

#### `invoices`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| invoice_number | VARCHAR(30) | NOT NULL UNIQUE (e.g. INV-2026-0001) |
| order_id | UUID | FK → orders(id), SET NULL |
| supplier_id | UUID | FK → suppliers(id), SET NULL |
| status | invoice_status | NOT NULL, default 'Draft' |
| issue_date | DATE | NOT NULL, default CURRENT_DATE |
| due_date | DATE | nullable |
| subtotal | NUMERIC(12,2) | NOT NULL, default 0 |
| discount_amt | NUMERIC(12,2) | default 0 |
| tax_amt | NUMERIC(12,2) | default 0 |
| total | NUMERIC(12,2) | NOT NULL, default 0 |
| amount_paid | NUMERIC(12,2) | default 0 |
| balance_due | NUMERIC(12,2) | default 0 |
| notes | TEXT | nullable |
| created_by | UUID | FK → users(id) |
| created_at / updated_at | TIMESTAMPTZ | |

---

#### `purchase_orders`
ERP-grade purchase orders sent to suppliers. Enhanced significantly in migration 002.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| po_number | VARCHAR(30) | NOT NULL UNIQUE (e.g. PO-2026-0001) |
| vendor_name | VARCHAR(150) | nullable (free-text legacy field) |
| status | po_status | NOT NULL, default 'Draft' |
| order_date | DATE | default CURRENT_DATE |
| expected_date | DATE | nullable |
| subtotal | NUMERIC(12,2) | default 0 |
| total | NUMERIC(12,2) | default 0 (legacy, use grand_total) |
| notes | TEXT | nullable |
| created_by | UUID | FK → users(id) |
| created_at / updated_at | TIMESTAMPTZ | |
| **New in migration 002:** | | |
| supplier_id | UUID | FK → suppliers(id) |
| supplier_reference | VARCHAR(100) | nullable (vendor's own ref) |
| payment_terms | VARCHAR(50) | nullable |
| currency | VARCHAR(3) | NOT NULL, default 'USD' |
| exchange_rate | NUMERIC(10,4) | NOT NULL, default 1 |
| buyer_id | UUID | FK → users(id) |
| department | VARCHAR(100) | nullable |
| priority | VARCHAR(10) | NOT NULL, default 'Medium'; CHECK IN ('Low','Medium','High','Urgent') |
| shipping_method | VARCHAR(50) | nullable |
| shipping_address | TEXT | nullable |
| billing_address | TEXT | nullable |
| terms_conditions | TEXT | nullable |
| approved_by | UUID | FK → users(id) |
| approved_at | TIMESTAMPTZ | nullable |
| cancelled_reason | TEXT | nullable |
| total_discount | NUMERIC(12,2) | NOT NULL, default 0 |
| total_tax | NUMERIC(12,2) | NOT NULL, default 0 |
| freight_charges | NUMERIC(12,2) | NOT NULL, default 0 |
| other_charges | NUMERIC(12,2) | NOT NULL, default 0 |
| grand_total | NUMERIC(12,2) | NOT NULL, default 0 |
| deleted_at | TIMESTAMPTZ | nullable (soft delete) |
| order_id | UUID | FK → orders(id) (linked production order) |

---

#### `purchase_order_items`
Line items for POs. Columns renamed and enhanced in migration 002.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| po_id | UUID | NOT NULL FK → purchase_orders(id) CASCADE |
| item_name | VARCHAR(255) | NOT NULL (was `description`) |
| description | TEXT | nullable (detail text, added in 002) |
| qty_ordered | INTEGER | NOT NULL (was `qty`) |
| unit_price | NUMERIC(12,2) | NOT NULL (was `unit_cost`) |
| line_total | NUMERIC(12,2) | NOT NULL (was `amount`) |
| discount_pct | NUMERIC(5,2) | NOT NULL, default 0 |
| discount_amt | NUMERIC(12,2) | NOT NULL, default 0 |
| tax_pct | NUMERIC(5,2) | NOT NULL, default 0 |
| tax_amt | NUMERIC(12,2) | NOT NULL, default 0 |
| hsn_code | VARCHAR(20) | nullable |
| uom | VARCHAR(20) | NOT NULL, default 'pcs' |
| product_id | UUID | FK → products(id), nullable |
| required_by_date | DATE | nullable |
| remarks | TEXT | nullable |
| sort_order | INTEGER | NOT NULL, default 0 |
| created_at | TIMESTAMPTZ | NOT NULL |

**Line total formula:**
```
base        = qty_ordered × unit_price
discount    = base × (discount_pct / 100)
after_disc  = base − discount
tax         = after_disc × (tax_pct / 100)
line_total  = after_disc + tax
```

---

#### `shipments`
| Column | Type |
|--------|------|
| id | UUID PK |
| shipment_number | VARCHAR(30) NOT NULL UNIQUE (SHP-2026-0001) |
| order_id | UUID FK → orders(id), SET NULL |
| supplier_id | UUID FK → suppliers(id), SET NULL |
| status | shipment_status NOT NULL |
| carrier | VARCHAR(80) nullable |
| tracking_number | VARCHAR(100) nullable |
| ship_date | DATE nullable |
| estimated_delivery | DATE nullable |
| weight_lbs | NUMERIC(8,2) nullable |
| shipping_cost | NUMERIC(12,2) nullable |
| recipient_name | VARCHAR(150) nullable |
| address | TEXT nullable |
| notes | TEXT nullable |
| created_by | UUID FK → users(id) |
| created_at / updated_at | TIMESTAMPTZ |

---

#### `products`
| Column | Type |
|--------|------|
| id | UUID PK |
| sku | VARCHAR(50) NOT NULL UNIQUE |
| name | VARCHAR(200) NOT NULL |
| product_type | product_type NOT NULL |
| description | TEXT nullable |
| base_price | NUMERIC(12,2) NOT NULL |
| cost_price | NUMERIC(12,2) default 0 |
| stock_qty | INTEGER default 0 |
| image_url | TEXT nullable |
| is_active | BOOLEAN NOT NULL, default true |
| created_by | UUID FK → users(id) |
| created_at / updated_at | TIMESTAMPTZ |
| deleted_at | TIMESTAMPTZ nullable (soft delete) |

---

#### `artworks`
| Column | Type |
|--------|------|
| id | UUID PK |
| artwork_no | VARCHAR(50) NOT NULL UNIQUE (AW-2026-0001) |
| name | VARCHAR(200) NOT NULL |
| supplier_id | UUID FK → suppliers(id), SET NULL |
| order_id | UUID FK → orders(id), SET NULL |
| status | artwork_status NOT NULL, default 'Pending Review' |
| file_url | TEXT nullable (path to uploaded file) |
| thumbnail_url | TEXT nullable |
| file_type | VARCHAR(20) nullable |
| tags | TEXT[] nullable (PostgreSQL array) |
| notes | TEXT nullable |
| uploaded_by | UUID FK → users(id), SET NULL |
| created_at / updated_at | TIMESTAMPTZ |

---

#### `activity_logs`
| Column | Type |
|--------|------|
| id | UUID PK |
| user_id | UUID FK → users(id), SET NULL |
| entity_type | VARCHAR(50) NOT NULL (e.g. 'supplier', 'order', 'lead') |
| entity_id | UUID NOT NULL |
| action | VARCHAR(80) NOT NULL (e.g. 'created', 'updated') |
| description | TEXT nullable |
| metadata | JSONB nullable |
| created_at | TIMESTAMPTZ NOT NULL |

---

#### `supplier_portal_users` *(was `customer_portal_users`)*
Portal login accounts, one per supplier.

| Column | Type |
|--------|------|
| id | UUID PK |
| supplier_id | UUID NOT NULL FK → suppliers(id) CASCADE |
| username | VARCHAR(255) NOT NULL UNIQUE |
| password_hash | VARCHAR(255) NOT NULL |
| is_active | BOOLEAN NOT NULL, default true |
| last_login | TIMESTAMPTZ nullable |
| must_change_pw | BOOLEAN NOT NULL, default true |
| created_by | UUID FK → users(id) |
| created_at / updated_at | TIMESTAMPTZ |

---

#### `portal_order_visibility`
Controls which orders a supplier can see in the portal.

| Column | Type |
|--------|------|
| id | UUID PK |
| order_id | UUID NOT NULL FK → orders(id) CASCADE |
| supplier_id | UUID NOT NULL FK → suppliers(id) CASCADE |
| sent_by | UUID FK → users(id) |
| sent_at | TIMESTAMPTZ NOT NULL |
| is_visible | BOOLEAN NOT NULL, default true |
| UNIQUE | (order_id, supplier_id) |

---

#### `portal_po_visibility`
Controls which POs a supplier can see in the portal.

| Column | Type |
|--------|------|
| id | UUID PK |
| po_id | UUID NOT NULL FK → purchase_orders(id) CASCADE |
| supplier_id | UUID NOT NULL FK → suppliers(id) CASCADE |
| sent_by | UUID FK → users(id) |
| sent_at | TIMESTAMPTZ NOT NULL |
| is_visible | BOOLEAN NOT NULL, default true |
| UNIQUE | (po_id, supplier_id) |

---

#### `portal_notifications`
In-app notifications shown to suppliers in the portal.

| Column | Type |
|--------|------|
| id | UUID PK |
| supplier_id | UUID NOT NULL FK → suppliers(id) CASCADE |
| type | VARCHAR(50) NOT NULL (e.g. 'new_order') |
| title | VARCHAR(255) NOT NULL |
| message | TEXT nullable |
| reference_id | UUID nullable |
| is_read | BOOLEAN NOT NULL, default false |
| created_at | TIMESTAMPTZ NOT NULL |

---

#### `po_attachments` *(added in migration 002)*
| Column | Type |
|--------|------|
| id | UUID PK |
| po_id | UUID NOT NULL FK → purchase_orders(id) CASCADE |
| filename | VARCHAR(255) NOT NULL |
| file_url | TEXT NOT NULL |
| file_size | INTEGER nullable |
| mime_type | VARCHAR(100) nullable |
| uploaded_by | UUID FK → users(id) |
| created_at | TIMESTAMPTZ NOT NULL |

---

#### `po_status_history` *(added in migration 002)*
Immutable log of every PO status transition.

| Column | Type |
|--------|------|
| id | UUID PK |
| po_id | UUID NOT NULL FK → purchase_orders(id) CASCADE |
| from_status | VARCHAR(50) nullable (null on first creation) |
| to_status | VARCHAR(50) NOT NULL |
| changed_by | UUID FK → users(id) |
| comment | TEXT nullable |
| created_at | TIMESTAMPTZ NOT NULL |

---

#### `portal_status_updates` *(added in migration 002)*
Production status submissions from suppliers via the portal.

| Column | Type |
|--------|------|
| id | UUID PK |
| order_id | UUID NOT NULL FK → orders(id) CASCADE |
| supplier_id | UUID NOT NULL FK → suppliers(id) CASCADE |
| status | VARCHAR(50) NOT NULL (e.g. 'In Production', 'Shipped') |
| notes | TEXT nullable |
| submitted_at | TIMESTAMPTZ NOT NULL |

---

### Migration Files Summary

| File | Location | Auto-applied? | Purpose |
|------|----------|--------------|---------|
| `db/init.sql` | `db/` | ✅ Docker startup | Full base schema |
| `db/portal_migration.sql` | `db/` | ✅ Docker startup | Portal tables |
| `db/002_supplier_rename.sql` | `db/` | ❌ Manual `psql` | Customer→Supplier rename + PO enhancement |
| `backend/migrations/001_setup.sql` | `backend/migrations/` | Via `npm run migrate` | Idempotent full schema (used in tests) |
| `backend/migrations/002_create_tables.sql` | `backend/migrations/` | Via `npm run migrate` | Additional tables |
| `backend/migrations/003_artwork_status.sql` | `backend/migrations/` | Via `npm run migrate` | Artwork status ENUM |

> **Note:** `db/002_supplier_rename.sql` must be run manually with `psql $DATABASE_URL -f db/002_supplier_rename.sql` — it is NOT auto-applied at Docker startup. The ENUM additions must run OUTSIDE the transaction block (Postgres limitation).

---

## 5. Backend API

**Base URL:** `http://localhost:8000/api`  
**Content-Type:** `application/json`  
**Authentication:** `Authorization: Bearer <JWT>` (except auth and portal login endpoints)

### Standard Response Format

All endpoints use helpers from `backend/src/utils/response.js`:

```json
// success()
{ "success": true, "message": "OK", "data": {...} }

// created()
{ "success": true, "message": "Created", "data": {...} }

// paginated()
{ "success": true, "data": { "rows": [...], "total": 42, "page": 1, "limit": 10, "totalPages": 5, "hasNext": true, "hasPrev": false } }

// error()
{ "success": false, "message": "Validation failed", "details": [...] }
```

### Authentication (`/api/auth`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/auth/setup-status` | None | Check if first admin exists |
| POST | `/api/auth/setup` | None | Create first admin account |
| POST | `/api/auth/login` | None | Login → returns `{ user, token }` |
| POST | `/api/auth/refresh` | None | Refresh JWT token |
| GET | `/api/auth/me` | ✅ JWT | Get current user profile |
| POST | `/api/auth/logout` | ✅ JWT | Logout (clears server-side if any) |
| POST | `/api/auth/change-password` | ✅ JWT | Change own password |

**Login request:** `{ email, password }` → `{ success, data: { user: { id, name, email, role }, token } }`

JWT payload: `{ id, email, role, iat, exp }` — expires per `JWT_EXPIRES_IN` env var (default `7d`)

---

### Users (`/api/users`) — Admin/Manager only

| Method | Path | Roles | Purpose |
|--------|------|-------|---------|
| GET | `/api/users` | Admin, Manager | List all users |
| GET | `/api/users/:id` | Admin, Manager | Get single user |
| POST | `/api/users` | Admin only | Create user |
| PUT | `/api/users/:id` | Admin only | Update user (name, role, phone, is_active) |
| DELETE | `/api/users/:id` | Admin only | Deactivate user |
| POST | `/api/users/:id/reset-password` | Admin only | Force reset password |

---

### Suppliers (`/api/suppliers`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/suppliers` | List with pagination; query params: `page`, `limit`, `search`, `status` |
| GET | `/api/suppliers/:id` | Get single supplier |
| GET | `/api/suppliers/:id/orders` | Get orders linked to supplier |
| POST | `/api/suppliers` | Create supplier |
| PUT | `/api/suppliers/:id` | Update supplier |
| DELETE | `/api/suppliers/:id` | Soft delete (sets `deleted_at`) |
| GET | `/api/suppliers/:id/portal-access` | Get portal login account |
| POST | `/api/suppliers/:id/portal-access` | Create/update portal credentials (Admin/Manager only) |
| DELETE | `/api/suppliers/:id/portal-access` | Deactivate portal access |

**Create/Update fields:** `name`, `email`, `phone`, `company`, `address_line1`, `address_line2`, `city`, `state`, `zip`, `country`, `notes`

---

### Leads (`/api/leads`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/leads` | Kanban board data (grouped by stage) |
| GET | `/api/leads/list` | Flat paginated list |
| GET | `/api/leads/:id` | Get single lead |
| POST | `/api/leads` | Create lead (`supplier_name`, `supplier_id`, `source`, `description`, `assigned_to`) |
| PUT | `/api/leads/:id` | Update lead fields |
| PATCH | `/api/leads/:id/move` | Move card in Kanban (`stage`, `position`) |
| DELETE | `/api/leads/:id` | Soft delete |
| GET | `/api/leads/:id/comments` | Get comments |
| POST | `/api/leads/:id/comments` | Add comment (`body`) |
| DELETE | `/api/leads/:id/comments/:cid` | Delete comment |
| POST | `/api/leads/:id/attachments` | Upload file attachment (multipart) |
| DELETE | `/api/leads/:id/attachments/:aid` | Delete attachment |

---

### Quotations (`/api/quotations`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/quotations` | List |
| GET | `/api/quotations/:id` | Get one |
| POST | `/api/quotations` | Create (`lead_id?`, `supplier_id?`, `valid_until?`, `discount_pct`, `tax_pct`, `notes`, `items[]`) |
| PUT | `/api/quotations/:id` | Update |
| PATCH | `/api/quotations/:id/status` | Change status (Draft/Sent/Approved/Rejected/Expired) |
| DELETE | `/api/quotations/:id` | Delete |

Item shape: `{ description, qty, unit_price }`

---

### Orders (`/api/orders`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/orders` | Paginated list; filter by `status`, `type`, `search`, `date_from`, `date_to` |
| GET | `/api/orders/board` | Kanban board grouped by status |
| GET | `/api/orders/:id` | Full order with items |
| GET | `/api/orders/:id/invoice` | Get linked invoice |
| POST | `/api/orders` | Create order (`order_type`, header fields, `items[]`) |
| PUT | `/api/orders/:id` | Update order + items (replaces all items) |
| PATCH | `/api/orders/:id/status` | Change status |
| DELETE | `/api/orders/:id` | Soft delete |
| POST | `/api/orders/:id/send-to-portal` | Send order to supplier portal (creates visibility + notification) |
| GET | `/api/orders/:id/portal-status` | Check if order is visible in portal |

**Order types require different item shapes:**
- `apparel`: `{ item, color, size, qty, artwork_no, artwork_size, unit_price, front_image, back_image }`
- `gangsheet`: `{ size, no_artworks, qty, price_per_sheet, front_image }`
- `dtf`: `{ artwork_name, size, qty, unit_price, artwork_image }`

---

### Invoices (`/api/invoices`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/invoices` | List |
| GET | `/api/invoices/:id` | Get one |
| POST | `/api/invoices` | Create (requires `order_id` OR `supplier_id`) |
| PUT | `/api/invoices/:id` | Update |
| PATCH | `/api/invoices/:id/status` | Change status |
| PATCH | `/api/invoices/:id/payment` | Record payment (`amount_paid`) |
| DELETE | `/api/invoices/:id` | Delete |

---

### Purchase Orders (`/api/purchase-orders`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/purchase-orders` | Paginated list; filter by `status`, `supplier_id` |
| GET | `/api/purchase-orders/:id` | Full PO with items, joins supplier + buyer names |
| POST | `/api/purchase-orders` | Create PO with full ERP fields + items |
| PUT | `/api/purchase-orders/:id` | Update PO |
| PATCH | `/api/purchase-orders/:id/status` | Change status + records history (`status`, `comment`) |
| DELETE | `/api/purchase-orders/:id` | Soft delete (`deleted_at = NOW()`) |
| GET | `/api/purchase-orders/:id/attachments` | List attachments |
| POST | `/api/purchase-orders/:id/attachments` | Upload attachment (multipart) |
| DELETE | `/api/purchase-orders/:id/attachments/:aid` | Delete attachment |
| GET | `/api/purchase-orders/:id/history` | Status change history (ordered newest first) |
| POST | `/api/purchase-orders/:id/send-to-portal` | Make PO visible to supplier in portal |

**Create payload fields:** `supplier_id`, `supplier_reference`, `payment_terms`, `currency`, `exchange_rate`, `buyer_id`, `department`, `priority`, `shipping_method`, `shipping_address`, `billing_address`, `terms_conditions`, `order_date`, `expected_date`, `notes`, `freight_charges`, `other_charges`, `order_id`, `items[]`

**Item fields:** `item_name`, `description`, `hsn_code`, `uom`, `qty_ordered`, `unit_price`, `discount_pct`, `tax_pct`, `required_by_date`, `remarks`, `sort_order`, `product_id`

---

### Shipments (`/api/shipments`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/shipments` | List |
| GET | `/api/shipments/:id` | Get one |
| POST | `/api/shipments` | Create (`order_id?`, `supplier_id?`, `carrier`, `tracking_number`, etc.) |
| PUT | `/api/shipments/:id` | Update |
| PATCH | `/api/shipments/:id/status` | Change status |
| DELETE | `/api/shipments/:id` | Delete |

---

### Products (`/api/products`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/products` | List active products |
| GET | `/api/products/:id` | Get one |
| POST | `/api/products` | Create (`sku`, `name`, `product_type`, `base_price`, etc.) |
| PUT | `/api/products/:id` | Update |
| PATCH | `/api/products/:id/toggle` | Toggle is_active |
| DELETE | `/api/products/:id` | Soft delete |

---

### Artworks (`/api/artworks`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/artworks` | List with filters |
| GET | `/api/artworks/board` | Board view grouped by status |
| GET | `/api/artworks/:id` | Get one |
| POST | `/api/artworks` | Upload artwork file (multipart `file` field + metadata) |
| POST | `/api/artworks/task` | Create artwork task without file |
| PATCH | `/api/artworks/:id/status` | Change review status |
| DELETE | `/api/artworks/:id` | Delete |

---

### Dashboard (`/api/dashboard`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/stats` | KPI summary (total orders, revenue, leads, etc.) |
| GET | `/api/dashboard/lead-pipeline` | Leads grouped by stage |
| GET | `/api/dashboard/orders-by-status` | Orders grouped by status |
| GET | `/api/dashboard/top-suppliers` | Top suppliers by order count/value |
| GET | `/api/dashboard/recent-activity` | Recent activity log entries |

---

### Supplier Portal (`/api/supplier`)

All portal endpoints use a **separate JWT** with `role: 'supplier'`. The `supplierAuth.js` middleware validates this token and populates `req.supplier = { supplierId, portalUserId, username, role }`.

#### Public (no auth)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/supplier/auth/login` | Portal login (`username`, `password`) → `{ token, supplier: {id, name, email}, mustChangePw }` |
| POST | `/api/supplier/auth/refresh` | Refresh supplier token |

#### Protected (supplier JWT required)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/supplier/me` | Get supplier profile |
| PATCH | `/api/supplier/me/password` | Change password |
| GET | `/api/supplier/dashboard` | Dashboard stats (order counts, chart data) |
| GET | `/api/supplier/orders` | Orders visible to this supplier; filters: `status`, `search`, `order_type`, `date_from`, `date_to`, `page`, `limit` |
| GET | `/api/supplier/orders/:id` | Order detail with items + artworks |
| POST | `/api/supplier/orders/:id/status-updates` | Submit production status update (`status`, `notes`) |
| GET | `/api/supplier/orders/:id/status-updates` | Get all status updates for an order |
| GET | `/api/supplier/purchase-orders` | POs visible to this supplier |
| GET | `/api/supplier/purchase-orders/:id` | PO detail with line items |
| GET | `/api/supplier/artworks` | Artworks linked to supplier's orders |
| GET | `/api/supplier/notifications` | Last 50 notifications |
| PATCH | `/api/supplier/notifications/:id/read` | Mark notification as read |

---

### Middleware

| Middleware | File | Purpose |
|-----------|------|---------|
| `verifyToken` | `auth.js` | Validates admin JWT; populates `req.user` |
| `requireRole(...roles)` | `auth.js` | Checks `req.user.role` is in allowed list |
| `requireSupplier` | `auth.js` | Checks `req.user.role === 'supplier'` |
| `supplierAuth` | `supplierAuth.js` | Validates supplier portal JWT; populates `req.supplier` |
| `validate(schema)` | `validate.js` | Runs Zod validation on `req.body`; returns 400 on failure |
| `uploadArtwork` | `upload.js` | multer — saves to `uploads/artworks/`, max 10MB |
| `uploadAttachment` | `upload.js` | multer — saves to `uploads/attachments/`, max 10MB |
| `errorHandler` | `errorHandler.js` | Global error handler, formats all uncaught errors |
| `helmet()` | Express | Security headers |
| `cors()` | Express | Origin whitelist (localhost always allowed) |
| `pinoHttp` | Express | HTTP request logging |

---

### Environment Variables Required

```
# Server
PORT=8000
NODE_ENV=development|production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Redis
REDIS_URL=redis://host:6379

# JWT
JWT_SECRET=<long-random-hex>
JWT_EXPIRES_IN=7d
JWT_CUSTOMER_EXPIRY=7d          # ⚠️ Legacy key name in .env — portal service uses JWT_SUPPLIER_EXPIRY

# File upload
UPLOAD_DIR=uploads
MAX_FILE_SIZE_MB=10
ALLOWED_MIME_TYPES=image/jpeg,image/png,image/webp,image/svg+xml,application/pdf

# CORS
CORS_ORIGIN=http://localhost,http://localhost:3001

# Portal
PORTAL_BASE_URL=http://localhost:3001

# Logging
LOG_LEVEL=info

# Google Drive (optional — for future cloud artwork storage)
# GOOGLE_CLIENT_EMAIL=
# GOOGLE_PRIVATE_KEY=
# GOOGLE_DRIVE_FOLDER_ID=
```

> ⚠️ The `.env` file contains `JWT_CUSTOMER_EXPIRY=7d` but `portal.service.js` reads `JWT_SUPPLIER_EXPIRY`. Add `JWT_SUPPLIER_EXPIRY=7d` to `.env` or it falls back to `'7d'` default.

---

## 6. Frontend Applications

### Admin Frontend (`decoinks-frontend`)

**Purpose:** Internal staff tool for the printshop. Full-featured POS/ERP interface.

**URL:** `http://localhost:80` (Docker) or `http://localhost:5173` (dev)

#### Routing Structure

All routes below `/` require authentication (via `ProtectedRoute` → `AppLayout`).

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | `LoginPage` | Email/password login |
| `/setup` | `SetupPage` | First-run: create initial admin |
| `/forgot-password` | `ForgotPasswordPage` | ⚠️ UI only, backend not wired |
| `/reset-password` | `ResetPasswordPage` | ⚠️ UI only |
| `/dashboard` | `DashboardPage` | KPI cards, charts (bar chart + pie), top suppliers table |
| `/leads/board` | `LeadBoardPage` | Kanban board across 6 stages, drag-to-move, add lead modal |
| `/leads/new` | `AddLeadPage` | New lead form with supplier search |
| `/quotes` | `QuotesListPage` | Searchable quotes table |
| `/quotes/new` | `NewQuotationPage` | Quote builder with line items, supplier combobox |
| `/quotes/:id/artwork` | `ArtworkFormPage` | Artwork review/approval form |
| `/invoices` | `WorkflowListPage` (invoices) | Invoice list |
| `/invoices/new` | `NewInvoicePage` | Invoice builder |
| `/invoices/:id` | `PlaceholderPage` | ⚠️ Not yet implemented |
| `/orders` | `WorkflowListPage` (orders) | Order list with filters |
| `/orders/new` | `NewOrderPage` | Multi-type order form (apparel/gangsheet/DTF) |
| `/orders/:id` | `OrderDetailPage` | Full order view, status update, send to portal |
| `/purchase-orders` | `WorkflowListPage` (purchase-orders) | PO list |
| `/purchase-orders/new` | `NewPurchaseOrderPage` | ERP PO form with line items + financial summary |
| `/purchase-orders/:id` | `PurchaseOrderDetailPage` | PO detail, status history, send to portal |
| `/shipments` | `ShipmentsPage` | Shipments table |
| `/shipments/new` | `NewShipmentPage` | Shipment creation |
| `/suppliers` | `SuppliersPage` | Supplier list with search |
| `/suppliers/new` | `NewSupplierPage` | Add supplier form |
| `/suppliers/:id` | `SupplierDetailPage` | Supplier profile, linked orders, portal access modal |
| `/products` | `ProductsPage` | Product catalog |
| `/artwork-library` | `ArtworkLibraryPage` | Artwork library browser |
| `/fulfillment/board` | `FulfillmentBoardPage` | Fulfillment Kanban |
| `/design/board` | `BoardPage` | Design review Kanban |
| `/settings/general` | `SettingsGeneralPage` | General settings |
| `/settings/ai-automations` | `AIAutomationsPage` | AI settings (mostly placeholder) |
| `/settings/workflows` | `SettingsWorkflowPage` | Workflow config |
| `/settings/integrations` | `SettingsIntegrationsPage` | Integrations |
| `/settings/billing` | `SettingsBillingPage` | Billing & Tax |
| `/settings/users` | `SettingsUsersPage` | User management |
| `/settings/users/:id` | `UserEditPage` | Edit user |

#### Key Components

- **`AppLayout.tsx`** — Full shell: collapsible sidebar (4 nav groups: Main, Artwork, Boards, System), topbar with search + notifications + user avatar menu. Uses MUI `Menu`/`MenuItem`/`Avatar`/`Badge`.
- **`PortalAccessModal.tsx`** — Modal to create or revoke a supplier's portal login. Props: `supplierId`, `supplierName`. Calls `POST /api/suppliers/:id/portal-access`.
- **`WorkflowListPage.tsx`** — Generic list page that accepts `kind` prop (`'orders'|'invoices'|'purchase-orders'`) and renders the appropriate list with filters.
- **`NewPurchaseOrderPage.tsx`** — Uses `useReducer` with `POFormState`. Two-column layout: main form (sections 1-4) + sticky financial summary sidebar. Calculates per-line totals on every keystroke.
- **`OrderDetailPage.tsx`** — Full order view with status menus, payment recording, "Send to Supplier Portal" menu item, portal status badge.

#### State Management

- **Auth:** Zustand `useAuthStore` — stores `{ user, token, isAuthenticated, isLoading }`. Token persisted in `localStorage` under key `'decoinks_token'`.
- **Server state:** TanStack React Query — all API calls use `useQuery`/`useMutation` with appropriate query keys.
- **Local UI state:** `useState`/`useReducer` per page.

#### API Integration

`src/services/api.ts` — Axios instance:
- `baseURL: '/api'`
- Request interceptor: reads `localStorage.getItem('decoinks_token')` and adds `Authorization: Bearer <token>`
- Response interceptor: on 401, removes token from localStorage and redirects to `/login`

#### Forms & Validation

No dedicated form library. Forms use React controlled components with manual validation before calling `useMutation`. Zod validation is backend-side only.

#### Design System

- **MUI v9** for complex interactive components (Menu, Badge, Avatar, Tooltip, Box)
- **Tailwind CSS v3** for layout and utility classes
- **Primary brand color:** `#0D9488` (teal/accent)
- **Sidebar color:** `#1F2937`
- **Custom CSS classes:** Defined in `src/index.css` — `np-*` (new purchase order page table styling), `sidebar-*`, `topbar-*`, `card`, `badge`, `btn-primary`, `btn-secondary`

---

### Supplier Portal (`customer-portal`)

**Purpose:** Vendor-facing portal where printing suppliers can log in to view orders sent to them, download artworks, check purchase orders, and submit production status updates.

**URL:** `http://localhost:3001` (Docker) or `http://localhost:3001` (dev)

> **Historical naming:** The directory is called `customer-portal` because the entities were originally called "customers." The code now uses `supplier` throughout after migration 002.

#### Routing Structure

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | `LoginPage` | Username or email + password login |
| `/change-password` | `ChangePasswordPage` | Forced on first login (`mustChangePw: true`) |
| `/` (index) | `DashboardPage` | Order stats cards, charts, recent orders |
| `/orders` | `OrdersPage` | Order list with status filters and type tabs |
| `/orders/:id` | `OrderDetailPage` | Full order with items, artworks; "Submit Status Update" button |
| `/orders/:id/status-updates` | `ProductionStatusPage` | Submit + view production status history |
| `/purchase-orders` | `PurchaseOrdersPage` | PO list |
| `/purchase-orders/:id` | `PurchaseOrderDetailPage` | PO detail with line items, financial summary, notes |
| `/artworks` | `ArtworksPage` | Artwork gallery for all orders |
| `/profile` | `ProfilePage` | View company profile (read-only) |

#### Key Components

- **`Layout.tsx`** — App shell with `<Sidebar />` and `<TopBar />`
- **`Sidebar.tsx`** — Nav links + supplier name at bottom. Routes: Dashboard, Orders, POs, Artworks, Profile.
- **`TopBar.tsx`** — Bell icon with unread notification count badge (polls every 30s). Supplier name + avatar initial.
- **`ProductionStatusPage.tsx`** — Form with dropdown of 9 status options + notes textarea. Submits to `POST /api/supplier/orders/:id/status-updates`. Shows timeline of all past updates.

#### State Management

- **Auth:** Zustand `useAuthStore` with `zustand/middleware/persist`. Persist key: `'decoinks-supplier-portal-auth'`. Stores `{ token, supplier: { id, name, email }, mustChangePw }`.
- **Server state:** TanStack React Query

#### API Integration

`src/services/api.ts` — Axios instance:
- `baseURL: import.meta.env.VITE_API_URL || '/api/supplier'`
- Request interceptor: reads from `useAuthStore.getState().token`
- Response interceptor: on 401, calls `useAuthStore.getState().logout()` then redirects to `/login`

#### Auth Flow

1. Supplier enters username (or company email) + password
2. `POST /api/supplier/auth/login` → returns JWT with `{ supplierId, portalUserId, role: 'supplier' }`
3. Token stored in Zustand persisted store
4. If `mustChangePw: true`, router redirects to `/change-password`
5. All subsequent requests carry `Authorization: Bearer <supplier-jwt>`
6. Supplier JWT has `role: 'supplier'` — this is validated by `supplierAuth.js` middleware

#### Environment Variables

```
VITE_API_URL=/api/supplier    # Can override for dev proxy
```

---

## 7. Key Features Implemented

### 1. Admin Authentication
**Files:** `backend/src/modules/auth/`, `decoinks-frontend/src/store/authStore.ts`  
Email + password login using bcrypt hash comparison. JWT returned and stored in localStorage. `initAuth()` on app load verifies token is still valid via `GET /api/auth/me`. Role-based access: Admin, Manager, Sales, Production, Viewer.

### 2. First-Run Setup
**File:** `decoinks-frontend/src/pages/SetupPage.tsx`, `backend/src/modules/auth/auth.routes.js`  
On first launch, `GET /api/auth/setup-status` checks if any user exists. If not, `/setup` route prompts to create the initial admin account.

### 3. Lead Pipeline (Kanban)
**Files:** `backend/src/modules/leads/`, `decoinks-frontend/src/pages/LeadBoardPage.tsx`, `AddLeadPage.tsx`  
Leads move through 6 stages (initiated → quotation → artwork → gangsheet → payment → confirmed) via drag-and-drop (`@hello-pangea/dnd`). Each lead card shows supplier name, source icon, comments, and artwork status. Stage position is persisted via `PATCH /api/leads/:id/move`.

### 4. Order Creation (Multi-type)
**Files:** `backend/src/modules/orders/`, `decoinks-frontend/src/pages/NewOrderPage.tsx`  
Three order types share a header form but have different item grids:
- **Apparel:** item/brand/color/size/qty/artwork no per row
- **Gangsheet:** sheet size/artwork count/qty per row  
- **DTF:** artwork name/size/qty per row  
Financial calculation: `subtotal → discount → tax → +rush/shipping → total`. Saved via `POST /api/orders`.

### 5. Order Detail & Status Management
**File:** `decoinks-frontend/src/pages/OrderDetailPage.tsx`  
Full order view with: status change menu (MUI Menu), payment status + amount recording, "Send to Supplier Portal" action (creates `portal_order_visibility` row + notification), portal sent indicator.

### 6. Purchase Order (ERP-grade)
**Files:** `backend/src/modules/purchase-orders/`, `decoinks-frontend/src/pages/NewPurchaseOrderPage.tsx`, `PurchaseOrderDetailPage.tsx`  
Full ERP PO form: supplier search dropdown, supplier reference, payment terms, buyer/department, shipping details, per-line discount%/tax% calculations, freight/other charges, grand total. Status history logged on every transition. Send to supplier portal action.

### 7. Invoice Management
**Files:** `backend/src/modules/invoices/`, `decoinks-frontend/src/pages/NewInvoicePage.tsx`  
Create invoices linked to orders or suppliers. Track payment (`amount_paid` → auto-calculate `balance_due`). Status: Draft → Sent → Paid/Overdue/Void.

### 8. Supplier Management
**Files:** `backend/src/modules/suppliers/`, `decoinks-frontend/src/pages/SuppliersPage.tsx`, `SupplierDetailPage.tsx`, `NewSupplierPage.tsx`  
Full CRUD for vendor/supplier accounts. Supplier detail page shows profile, linked orders, and portal access management (create credentials, revoke access). `PortalAccessModal` component handles credential creation inline.

### 9. Artwork Library
**Files:** `backend/src/modules/artworks/`, `decoinks-frontend/src/pages/ArtworkLibraryPage.tsx`, `ArtworkFormPage.tsx`  
Upload artwork files (PNG/JPG/PDF/AI/EPS up to 10MB) via multipart form. Status workflow: Draft → Pending Approval → Approved/Revision Needed/Rejected. Board view groups by status. Artworks linked to orders visible in supplier portal.

### 10. Supplier Portal — Order Viewing
**Files:** `backend/src/modules/supplier-portal/portal.service.js`, `customer-portal/src/pages/OrdersPage.tsx`, `OrderDetailPage.tsx`  
Admin sends order via "Send to Portal" → creates `portal_order_visibility` record + notification. Supplier logs in and sees only their visible orders. Order detail shows items, artworks (with download), and linked PO number.

### 11. Supplier Portal — Production Status Updates
**Files:** `backend/src/modules/supplier-portal/portal.service.js`, `customer-portal/src/pages/ProductionStatusPage.tsx`  
Supplier can submit production status updates (9 options: In Production, Materials Received, Printing Started, etc.) with notes. Timeline of all past updates shown. Stored in `portal_status_updates` table. Accessible to admin via `GET /api/supplier/orders/:id/status-updates`.

### 12. Supplier Portal — PO Viewing
**Files:** `portal.service.js`, `customer-portal/src/pages/PurchaseOrdersPage.tsx`, `PurchaseOrderDetailPage.tsx`  
Admin sends PO via "Send to Portal" → creates `portal_po_visibility` record. Supplier sees PO list and full detail with line items, totals, payment terms, notes.

### 13. Portal Notifications
**Files:** `portal.service.js`, `customer-portal/src/components/TopBar.tsx`  
Notifications stored in `portal_notifications` table. TopBar polls `GET /api/supplier/notifications` every 30 seconds and shows unread count badge on bell icon. Mark as read via PATCH endpoint.

### 14. Forced Password Change
**Files:** `portal.service.js`, `customer-portal/src/pages/ChangePasswordPage.tsx`  
New portal accounts have `must_change_pw = TRUE`. On login, `mustChangePw: true` is returned. Portal router redirects to `/change-password`. After successful change, `must_change_pw = FALSE` in DB.

### 15. Sequential Business Numbers
**File:** `backend/src/utils/counter.js`  
All entities get numbers in format `PREFIX-YYYY-NNNN` (e.g., `ORD-2026-0042`). Uses `pg_advisory_xact_lock` for race-free generation. Prefixes: `LEAD`, `QT`, `ORD`, `INV`, `PO`, `SHP`, `AW`.

### 16. Dashboard Analytics
**Files:** `backend/src/modules/dashboard/`, `decoinks-frontend/src/pages/DashboardPage.tsx`  
5 aggregated endpoints providing: KPI stats (orders/revenue/leads), lead pipeline (by stage), orders by status, top suppliers, recent activity. Frontend renders with Recharts bar + pie charts.

### 17. File Upload (Local Disk)
**File:** `backend/src/middleware/upload.js`  
multer with disk storage. Artworks → `uploads/artworks/`, attachments → `uploads/attachments/`. Files renamed to `uuid + original_extension`. Served statically at `/uploads/*`. Max 10MB, allowed types configurable.

---

## 8. Known Issues / In-Progress Work

### Identified Issues

1. **`.env` key mismatch:** File has `JWT_CUSTOMER_EXPIRY=7d` but `portal.service.js` reads `process.env.JWT_SUPPLIER_EXPIRY`. Falls back to `'7d'` so it works, but the env var should be renamed.

2. **Invoice detail page not implemented:** `/invoices/:id` routes to `PlaceholderPage`. The detail view is not yet built.

3. **Forgot password / Reset password pages are UI-only:** `ForgotPasswordPage.tsx` and `ResetPasswordPage.tsx` exist with forms but the backend endpoints are not implemented.

4. **`customers/` and `customer-portal/` legacy modules:** `backend/src/modules/customers/` and `backend/src/modules/customer-portal/` are dead code (not mounted in `app.js`). They can be deleted safely.

5. **Dead frontend files:** `decoinks-frontend/src/pages/CustomerDetailPage.tsx`, `CustomersPage.tsx`, `NewCustomerPage.tsx` are no longer routed. Can be deleted.

6. **`useCustomerAuth.ts` is dead code:** `customer-portal/src/hooks/useCustomerAuth.ts` exists but no page imports it. It was updated to use `supplier` naming to pass TypeScript compilation but serves no purpose.

7. **File uploads not persisted to Google Drive:** `backend/src/config/googleDrive.js` exists and `googleapis` is installed, but the Google Drive integration is commented out in `.env`. Files are stored on local disk only (not cloud-backed).

8. **PO `send-to-portal` overrides supplier:** `POST /api/purchase-orders/:id/send-to-portal` accepts optional `supplier_id` to override. But if PO already has a `supplier_id`, the override pattern should be clarified.

9. **`order.supplier_name` not always returned:** Some order list queries may not include `supplier_name` in the JOIN. Pages fall back to `—` display.

10. **No email sending:** Portal notifications are stored in the DB but no email is sent when a new order/PO is shared. `PORTAL_BASE_URL` env var exists for future use.

### TODO/Placeholder Features (AI Automations, Integrations, Billing settings)

These settings pages exist in the UI (`AIAutomationsPage`, `SettingsWorkflowPage`, `SettingsIntegrationsPage`, `SettingsBillingPage`) but render mostly static content or placeholder UI. No backend endpoints back these pages.

---

## 9. Conventions & Patterns

### File Naming

- **Backend:** `snake_case` for all files (e.g., `suppliers.service.js`, `auth.routes.js`)
- **Frontend pages:** `PascalCase` + `Page` suffix (e.g., `SuppliersPage.tsx`, `OrderDetailPage.tsx`)
- **Frontend components:** `PascalCase` (e.g., `PortalAccessModal.tsx`, `AppLayout.tsx`)
- **Backend modules:** Each feature has a `feature.routes.js`, `feature.service.js`, `feature.controller.js` triad

### Backend Patterns

**Route → Controller → Service separation:**
```
routes.js    →  validates with Zod, calls controller function
controller.js → calls service, handles response formatting
service.js    → all SQL queries and business logic
```

**Response utilities (always used):**
```js
// success cases
return success(res, data)          // 200
return created(res, data)          // 201
return paginated(res, rows, total, page, limit)  // 200

// errors
return error(res, 'Not found', 404)
```

**Zod validation:**
All `POST`/`PUT`/`PATCH` routes use `validate(schema)` middleware. Validation errors return `{ success: false, message: "Validation failed", details: [...] }` with 400.

**Sequential numbers:**
Always via `getNextNumber(prefix, table, column)` — never manual or `MAX()+1`.

**Soft deletes:**
`deleted_at TIMESTAMPTZ` column — set `deleted_at = NOW()`, queries filter `WHERE deleted_at IS NULL`.

**Transactions:**
Multi-step operations (create PO + items + history) use `getClient()` → `BEGIN`/`COMMIT`/`ROLLBACK`.

### Frontend Patterns

**API calls:** Always via `useQuery` or `useMutation` from TanStack React Query. Never `useEffect + fetch`.

**Query keys:** Semantic arrays like `['suppliers', id]`, `['po-history', id]`, `['suppliers-for-po']`.

**Success/error feedback:** Always `toast.success('...')` / `toast.error(err.response?.data?.message ?? 'fallback')`.

**Forms:**
- Simple forms: `useState` per field
- Complex multi-section forms: `useReducer` with typed state interface (see `NewPurchaseOrderPage.tsx`)

**Inline styling vs Tailwind:** Use Tailwind utility classes for layout; inline `style={{}}` for dynamic or page-specific values. Custom CSS classes (e.g., `np-card`, `btn-primary`) defined in `src/index.css`.

**Dropdown/combobox pattern:**
```tsx
// Supplier search: local state for search text, onBlur closes with setTimeout delay
const [open, setOpen] = useState(false)
const [search, setSearch] = useState('')
// setTimeout(() => setOpen(false), 150) in onBlur to allow click to register
```

### CSS Classes in Admin Frontend (`index.css`)

Custom utility classes used throughout:
- `card` — white rounded box with border
- `btn-primary` / `btn-secondary` — action buttons
- `badge` — status pill
- `np-card`, `np-table`, `np-table-input`, `np-num-input` — purchase order page table styling
- `np-info-bar` — top info strip on PO pages
- `lb-action-btn`, `lb-action-primary` — action bar buttons
- `sidebar-*`, `topbar-*` — layout shell classes
- `app-shell`, `main-column`, `content-area` — page structure

### Testing

Backend tests use Jest + Supertest:
```
tests/integration/  — full HTTP round-trip tests against real test DB
tests/unit/         — pure function tests for counter, response, validate
```

Test setup in `tests/setup.js` loads `.env`. `helpers.js` provides:
- `runMigrations()` — applies `001_setup.sql`
- `seedAdmin()` — creates test admin (email: `admin@test.com`, password: `adminpass123`)
- `truncateTestTables()` — truncates all main tables
- `truncateUsers()` — `DELETE FROM users`

Tests run sequentially (`--runInBand`) to avoid connection conflicts.

---

## 10. How to Run Locally

### Prerequisites

- Docker Desktop (for the recommended Docker path)
- OR: Node.js 20, PostgreSQL 15, Redis 7 (for manual path)

### Option A: Docker Compose (Recommended)

```bash
# Clone and enter the project
cd "POS Software"

# Fresh start (wipes DB, rebuilds all images)
docker compose down -v && docker compose up --build -d

# View logs
docker compose logs -f backend
docker compose logs -f customer_portal

# Run backend tests (against test DB — runs with test env)
docker compose exec backend npm test

# Seed demo data (optional)
docker compose exec backend npm run seed
docker compose exec backend npm run seed:admin
```

**Access:**
- Admin POS: `http://localhost` (port 80)
- Supplier Portal: `http://localhost:3001`
- Backend API: `http://localhost:8000/api`
- PostgreSQL: `localhost:5432` (user: postgres, pass: decoinks_pass, db: decoinks_db)

**Default admin credentials (after seed-admin):**
- Email: `admin@test.com` / Password: `adminpass123`

### Option B: Manual (Development)

#### Backend

```bash
cd backend
cp .env.example .env   # Edit DATABASE_URL and REDIS_URL to point to local services
npm install
npm run migrate        # Applies migration files in order
npm run seed:admin     # Create admin user
npm run dev            # Starts with --watch (auto-restart on changes)
```

#### Admin Frontend

```bash
cd decoinks-frontend
npm install
npm run dev            # Starts Vite dev server at http://localhost:5173
```

The frontend proxies `/api` to `http://localhost:8000` via the Vite config.

#### Supplier Portal

```bash
cd customer-portal
npm install
npm run dev            # Starts at http://localhost:3001
```

### Apply Migration 002 (Supplier Rename + PO Enhancement)

After running the base schema, apply migration 002 manually:

```bash
# Inside Docker
docker compose exec postgres psql -U postgres -d decoinks_db -f /dev/stdin < db/002_supplier_rename.sql

# Or from host with psql installed
psql postgresql://postgres:decoinks_pass@localhost:5432/decoinks_db -f db/002_supplier_rename.sql
```

> ⚠️ This migration contains `ALTER TYPE ... ADD VALUE` statements that **must run outside a transaction**. The SQL file handles this by having those statements before the `BEGIN;` block.

### Database Setup Without Docker

```sql
-- Create DB
CREATE DATABASE decoinks_db;

-- Connect and run
\c decoinks_db
\i db/init.sql
\i db/portal_migration.sql
\i db/002_supplier_rename.sql  -- if needed
```

---

## 11. Deployment

### Current Configuration

⚠️ **NOT FOUND** — No CI/CD pipeline files (`.github/workflows/`, `gitlab-ci.yml`, etc.) exist in the project. No production deployment target is configured.

### What Exists

- **Dockerfiles:** Both frontends have production Dockerfiles (Vite build → nginx static serve). Backend has a multi-stage Dockerfile (`base` → `dev` production).
- **Docker Compose:** Configured for development (`target: dev` for backend). For production, the `target` should be changed to `prod` and backend volume mounts removed.

### Steps for Production Deployment

1. Set `NODE_ENV=production` in `.env`
2. Set secure `JWT_SECRET` (64+ character random hex)
3. Set `DATABASE_URL` pointing to production PostgreSQL
4. Remove `volumes: - ./backend:/app` from compose (or use a production compose override)
5. Ensure `db/002_supplier_rename.sql` has been applied to the production DB
6. Run `docker compose up --build -d`

### Build Commands

```bash
# Backend: no build step needed (Node.js)
# Admin frontend production build:
cd decoinks-frontend && npm run build   # outputs to dist/

# Supplier portal production build:
cd customer-portal && npm run build     # outputs to dist/
```

---

## 12. For AI Assistants Reading This Document

### What This Is

This is a **full-stack printshop operations system** built with:
- **Backend:** Node.js + Express + PostgreSQL (raw SQL, no ORM) + Redis
- **Admin frontend:** React 18 + TypeScript + Vite + TanStack Query + Zustand + MUI + Tailwind CSS
- **Supplier portal:** React 18 + TypeScript + Vite + TanStack Query + Zustand (persist) + Tailwind CSS
- **Infrastructure:** Docker Compose with 5 services

### When Suggesting Code Changes, Follow These Conventions

1. **Backend services use raw SQL** — no ORM. All queries via `db.query(sql, params)` or within a `getClient()` transaction. Never suggest Prisma, Sequelize, or TypeORM.

2. **Zod validation belongs in routes files** — Define schemas in `module.routes.js`. Use the `validate(schema)` middleware pattern.

3. **Always use response helpers** — `success(res, data)`, `created(res, data)`, `paginated(res, rows, total, page, limit)`, `error(res, msg, status)` from `backend/src/utils/response.js`.

4. **Sequential numbers via counter** — `const num = await getNextNumber('PREFIX', 'table', 'column_name')`. Never compute manually.

5. **Frontend API calls use React Query** — `useQuery` for reads, `useMutation` for writes. Never `useEffect + fetch/axios`.

6. **Toast for user feedback** — `toast.success('...')` / `toast.error(err.response?.data?.message ?? 'fallback')`.

7. **Supplier portal uses older lucide-react (0.395.0)** — Only use icons confirmed to exist: `Loader2`, `ArrowLeft`, `Download`, `ZoomIn`, `ZoomOut`, `Maximize2`, `RefreshCw`, `Bell`, `X`, `Check`, `ChevronRight`, `ChevronLeft`. Do NOT use `Send`, `ArrowRight`, or other newer icons in `customer-portal/`.

8. **The entity is `supplier` not `customer`** — Tables, columns, API routes, variable names, and UI labels all use "supplier". The old "customer" naming was renamed in migration 002. Never reintroduce customer naming.

9. **TypeScript strictness in portal** — The `customer-portal` uses `tsc && vite build` (strict TS check). The admin frontend uses `vite build` only (lenient). Portal TS errors block the build.

10. **Soft deletes use `deleted_at` column** — When listing, always add `WHERE deleted_at IS NULL`. Deletes are `UPDATE ... SET deleted_at = NOW()`.

### When Adding New Features, Place Them In

| Feature type | Location |
|-------------|----------|
| New backend API module | `backend/src/modules/<feature>/` (routes + service + controller) + mount in `app.js` |
| New admin page | `decoinks-frontend/src/pages/<FeatureName>Page.tsx` + add route in `src/router/index.tsx` |
| New supplier portal page | `customer-portal/src/pages/<FeatureName>Page.tsx` + add route in `src/router/index.tsx` |
| Shared admin component | `decoinks-frontend/src/components/` |
| New DB table | Create migration SQL in `db/` + add to `backend/migrations/001_setup.sql` (for test resets) + update `tests/integration/helpers.js` `truncateTestTables()` |

### Always Match These Existing Patterns

- **Backend module pattern:** `backend/src/modules/suppliers/` — clean example of routes/service/controller split
- **Complex form with `useReducer`:** `decoinks-frontend/src/pages/NewPurchaseOrderPage.tsx`
- **Portal auth pattern:** `customer-portal/src/store/authStore.ts` + `customer-portal/src/services/api.ts`
- **Portal page with query + mutation:** `customer-portal/src/pages/ProductionStatusPage.tsx`
- **Admin detail page with modals:** `decoinks-frontend/src/pages/PurchaseOrderDetailPage.tsx`

### Language Preference

The user (Arun Kumar) communicates in **English**. All code comments, variable names, UI strings, and responses should be in English. Roman Urdu or Urdu is not needed in code.

### Critical Rules

- **DO NOT** use `app.js` in the backend — the file is `app.js` (CommonJS), not ESM
- **DO NOT** add `import` statements to backend files — all backend is CommonJS (`require`/`module.exports`)
- **DO NOT** change the database table name `suppliers` back to `customers`
- **DO NOT** add features to `PlaceholderPage` routes — create proper pages and wire the router
- **When testing backend changes,** run `docker compose exec backend npm test` and verify all tests pass

---

*Document generated: 2026-05-21 | Project: Decoinks Printshop OS | Stack: Node.js/Express/PostgreSQL + React/TypeScript*
