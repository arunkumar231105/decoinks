'use strict'

const fs      = require('fs')
const path    = require('path')
const bcrypt  = require('bcryptjs')
const { pool } = require('../../src/config/db')

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations')

// Ordered list of migration files to apply in tests (all idempotent via IF NOT EXISTS / DO blocks)
const MIGRATION_FILES = [
  '001_setup.sql',
  '010_create_payments_table.sql',
  '011_create_pipeline_events_table.sql',
  '016_custom_fields.sql',
  '017_po_tracking.sql',
  '018_gangsheet.sql',
  '019_custom_field_values.sql',
  '020_lead_quote_intake.sql',
]

async function runMigrations() {
  for (const file of MIGRATION_FILES) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    await pool.query(sql)
  }
}

async function seedAdmin() {
  const hash = await bcrypt.hash('adminpass123', 10)
  await pool.query(`
    INSERT INTO users (id, name, email, password, role)
    VALUES (uuid_generate_v4(), 'Test Admin', 'admin@test.com', $1, 'Admin')
    ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = 'Admin'
  `, [hash])
}

async function truncateTestTables() {
  await pool.query(`
    TRUNCATE TABLE
      custom_field_values,
      custom_fields,
      activity_logs,
      pipeline_events,
      payments,
      order_items_apparel,
      order_items_gangsheet,
      order_items_dtf,
      orders,
      lead_comments,
      lead_attachments,
      lead_product_interest,
      leads,
      suppliers,
      quotations,
      invoices,
      purchase_orders,
      shipments,
      products,
      artworks
    RESTART IDENTITY CASCADE
  `)
}

async function truncateUsers() {
  await pool.query(`TRUNCATE TABLE users CASCADE`)
}

module.exports = { runMigrations, seedAdmin, truncateTestTables, truncateUsers }
