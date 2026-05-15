'use strict'

const fs      = require('fs')
const path    = require('path')
const bcrypt  = require('bcryptjs')
const { pool } = require('../../src/config/db')

const MIGRATION_FILE = path.join(__dirname, '../../migrations/001_setup.sql')

async function runMigrations() {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8')
  await pool.query(sql)
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
      activity_logs,
      order_items_apparel,
      order_items_gangsheet,
      order_items_dtf,
      orders,
      lead_comments,
      lead_attachments,
      leads,
      customers,
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
  await pool.query(`DELETE FROM users`)
}

module.exports = { runMigrations, seedAdmin, truncateTestTables, truncateUsers }
