-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums (skip if already exist)
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('Admin', 'Manager', 'Sales', 'Production', 'Viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE customer_status AS ENUM ('Active', 'Inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_stage AS ENUM ('initiated', 'quotation', 'artwork', 'gangsheet', 'payment', 'confirmed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('New', 'Quotation', 'Pending', 'Payment Sent', 'Partial', 'Confirmed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_source AS ENUM ('Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM ('Draft', 'Sent', 'Approved', 'Rejected', 'Expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_type AS ENUM ('apparel', 'gangsheet', 'dtf');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('Draft', 'Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Delivered', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('Unpaid', 'Partial', 'Paid', 'Refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cashapp', 'zelle', 'paypal', 'bank_transfer', 'cash', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_terms AS ENUM ('Due on Receipt', 'Net 15', 'Net 30', 'Net 60');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('Draft', 'Sent', 'Paid', 'Overdue', 'Void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE po_status AS ENUM ('Draft', 'Sent', 'Received', 'Partial', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM ('Pending', 'Label Created', 'Picked Up', 'In Transit', 'Delivered', 'Exception');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE product_type AS ENUM ('Apparel', 'DTF', 'Gangsheet', 'Embroidery', 'Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE artwork_status AS ENUM ('Pending Review', 'Approved', 'Revision Needed', 'Rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
