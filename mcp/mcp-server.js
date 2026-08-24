#!/usr/bin/env node
// Decoinks Printshop OS — read-only MCP seat.
//
// Lets ChatGPT answer real questions about the business — how many orders this
// month, who still owes money, DTF versus apparel — from the live database.
//
// It reads the `reporting` schema, never the base tables. That matters: 12
// tables soft-delete, so `public.orders` holds 170 rows where the software
// shows 126, and `public.invoices` holds 68 invoices that were deleted.
// The reporting views apply the same filter the app applies, so a number the
// boss reads here is the number the boss sees on screen.
//
// Three locks, each sufficient on its own:
//   1. It connects as decoinks_readonly, which the database refuses to let write.
//   2. That role cannot see the base tables at all — only `reporting`.
//   3. safeSelect() rejects anything that is not a single SELECT.
import express from 'express'
import pg from 'pg'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

// Credentials come from PG* env vars, so a password containing @ or / needs no
// URL-escaping and never has to be pasted into a connection string.
const pool = new pg.Pool({ max: 4, connectionTimeoutMillis: 20000, query_timeout: 60000, statement_timeout: 60000 })
// Unqualified names resolve to the filtered views, so `FROM orders` is already correct.
pool.on('connect', (c) => c.query('SET search_path TO reporting'))
const q = (sql, params) => pool.query(sql, params)

function safeSelect(sql) {
  let s = String(sql || '').trim().replace(/;+\s*$/, '')
  if (!/^select\b/i.test(s)) return null
  if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy)\b/i.test(s) || s.includes(';')) return null
  if (!/\blimit\b/i.test(s)) s += ' LIMIT 200'
  return s
}
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] })
const err = (m) => ({ content: [{ type: 'text', text: `Error: ${m}` }], isError: true })

let SCHEMA = null
async function schemaText() {
  if (SCHEMA) return SCHEMA
  const r = await q(`SELECT table_name, column_name FROM information_schema.columns
                     WHERE table_schema = 'reporting' ORDER BY table_name, ordinal_position`)
  const byTable = {}
  for (const row of r.rows) (byTable[row.table_name] ||= []).push(row.column_name)
  SCHEMA = Object.entries(byTable).map(([t, cols]) => `${t}(${cols.join(', ')})`).join('\n')
  return SCHEMA
}

const server = new McpServer({ name: 'decoinks-reporting', version: '1.0.0' })

server.tool('business_overview',
  'Headline numbers for the print shop: orders, invoices, quotations, purchase orders, customers, revenue billed, revenue collected and outstanding balance. Use this first for any "how many / how much / overview" question.',
  {}, async () => {
    const r = await q(`SELECT
        (SELECT count(*) FROM orders)                                   AS orders,
        (SELECT count(*) FROM invoices)                                 AS invoices,
        (SELECT count(*) FROM quotations)                               AS quotations,
        (SELECT count(*) FROM purchase_orders)                          AS purchase_orders,
        (SELECT count(*) FROM customers)                                AS customers,
        (SELECT count(*) FROM leads)                                    AS leads,
        (SELECT coalesce(sum(total),0)        FROM invoices)             AS billed,
        (SELECT coalesce(sum(amount_paid),0)  FROM invoices)             AS collected,
        (SELECT coalesce(sum(balance_due),0)  FROM invoices)             AS outstanding`)
    return text(r.rows[0])
  })

server.tool('get_schema',
  'The tables and columns available to you. Every one already hides deleted records, so counts here match what the software shows. Read this before writing SQL with run_sql.',
  {}, async () => text(await schemaText()))

server.tool('run_sql',
  'Run a READ-ONLY SELECT and get exact numbers. Call get_schema first. Table names are unqualified (orders, invoices, customers). Anything that is not a single SELECT is rejected.',
  { sql: z.string().describe('A single SELECT statement. No semicolons, no writes.') },
  async ({ sql }) => {
    const safe = safeSelect(sql)
    if (!safe) return err('Only a single read-only SELECT is allowed (no writes, no semicolons).')
    try {
      const r = await q(safe)
      return text({ rows: r.rowCount, data: r.rows })
    } catch (e) { return err(e.message) }
  })

server.tool('search_customers',
  'Find customers by name (partial match), with how many orders they have placed and what they still owe.',
  { name: z.string().describe('Part of the customer name'), limit: z.number().optional() },
  async ({ name, limit }) => {
    const r = await q(
      `SELECT c.id, c.customer_number, c.company_name, c.email, c.phone,
              (SELECT count(*) FROM orders o WHERE o.customer_id = c.id)                     AS orders,
              (SELECT coalesce(sum(i.total),0)       FROM invoices i WHERE i.customer_id = c.id) AS billed,
              (SELECT coalesce(sum(i.balance_due),0) FROM invoices i WHERE i.customer_id = c.id) AS outstanding
         FROM customers c
        WHERE c.company_name ILIKE '%'||$1||'%'
        ORDER BY outstanding DESC, c.company_name
        LIMIT $2`, [name, Math.min(limit || 25, 100)])
    return text(r.rows)
  })

server.tool('get_customer',
  'Everything about ONE customer by id: their details, their orders, and their invoices with balances.',
  { id: z.string().describe('Customer id from search_customers') },
  async ({ id }) => {
    const c = await q('SELECT * FROM customers WHERE id = $1', [id])
    if (!c.rowCount) return err('No such customer.')
    const o = await q('SELECT order_number, order_type, status, total, order_date FROM orders WHERE customer_id = $1 ORDER BY order_date DESC LIMIT 100', [id])
    const i = await q('SELECT invoice_number, issue_date, total, amount_paid, balance_due, status FROM invoices WHERE customer_id = $1 ORDER BY issue_date DESC LIMIT 100', [id])
    return text({ customer: c.rows[0], orders: o.rows, invoices: i.rows })
  })

server.tool('money_owed',
  'Which customers still owe money, largest balance first. Use for "who owes us / outstanding / receivables" questions.',
  { limit: z.number().optional() },
  async ({ limit }) => {
    const r = await q(
      `SELECT c.company_name, count(i.*) AS unpaid_invoices,
              sum(i.balance_due) AS outstanding, min(i.issue_date) AS oldest_invoice
         FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.balance_due > 0
        GROUP BY c.company_name
        ORDER BY outstanding DESC
        LIMIT $1`, [Math.min(limit || 25, 100)])
    return text(r.rows)
  })

server.tool('revenue_by_month',
  'Invoiced and collected totals per month, newest first. Use for trends, "this month", "last quarter", year-on-year.',
  { months: z.number().optional().describe('How many months back (default 12)') },
  async ({ months }) => {
    const r = await q(
      `SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month,
              count(*) AS invoices, sum(total) AS billed,
              sum(amount_paid) AS collected, sum(balance_due) AS outstanding
         FROM invoices
        WHERE issue_date >= date_trunc('month', CURRENT_DATE) - make_interval(months => $1)
        GROUP BY 1 ORDER BY 1 DESC`, [Math.min(months || 12, 60)])
    return text(r.rows)
  })

server.tool('orders_by_channel',
  'Order counts and value split by channel and order type — DTF transfer, DTF apparel, gang sheet, TSI versus DIGI.',
  {}, async () => {
    const r = await q(
      `SELECT coalesce(sales_channel,'unknown')||' '||
              CASE WHEN order_type = 'dtf' THEN 'DTF Transfer' ELSE 'DTF Apparel' END AS channel,
              sales_channel, order_type,
              count(*) AS orders, coalesce(sum(total),0) AS value
         FROM orders GROUP BY sales_channel, order_type ORDER BY orders DESC`)
    return text(r.rows)
  })

// ChatGPT connectors expect a search/fetch pair.
server.tool('search',
  'Search the business for customers, orders or invoices matching a query. Returns id + title + snippet.',
  { query: z.string() },
  async ({ query }) => {
    const r = await q(
      `SELECT 'customer:'||id AS id, company_name AS title,
              coalesce(email,'')||' '||coalesce(phone,'') AS snippet FROM customers
        WHERE company_name ILIKE '%'||$1||'%'
       UNION ALL
       SELECT 'order:'||id, order_number, coalesce(order_type,'')||' '||coalesce(status::text,'') FROM orders
        WHERE order_number ILIKE '%'||$1||'%'
       UNION ALL
       SELECT 'invoice:'||id, invoice_number, 'balance '||coalesce(balance_due,0)::text FROM invoices
        WHERE invoice_number ILIKE '%'||$1||'%'
       LIMIT 50`, [query])
    return text(r.rows)
  })

server.tool('fetch',
  'Fetch the full record for an id returned by search (e.g. "order:123").',
  { id: z.string() },
  async ({ id }) => {
    const [kind, key] = String(id).split(':')
    const t = { customer: 'customers', order: 'orders', invoice: 'invoices' }[kind]
    if (!t) return err('id must look like customer:<id>, order:<id> or invoice:<id>')
    const r = await q(`SELECT * FROM ${t} WHERE id = $1`, [key])
    if (!r.rowCount) return err('Not found.')
    return text({ id, title: kind, text: JSON.stringify(r.rows[0], null, 1), url: null })
  })

const MODE = (process.env.MCP_MODE || 'stdio').toLowerCase()

if (MODE === 'http') {
  const TOKEN = process.env.MCP_TOKEN
  if (!TOKEN) { console.error('MCP_TOKEN is required in http mode (a long random string).'); process.exit(1) }
  const BASE = process.env.MCP_BASE_PATH || ''
  const app = express()
  app.use(express.json({ limit: '2mb' }))
  const authOk = (req) => {
    const h = req.headers.authorization || ''
    return h === `Bearer ${TOKEN}` || req.query.key === TOKEN || req.query.token === TOKEN
  }
  app.get('/health', (_q, res) => res.json({ ok: true, server: 'decoinks-reporting-mcp' }))

  app.post('/mcp', async (req, res) => {
    if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => transport.close())
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  const sseTransports = {}
  app.get('/sse', async (req, res) => {
    if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' })
    const transport = new SSEServerTransport(`${BASE}/messages`, res)
    sseTransports[transport.sessionId] = transport
    res.on('close', () => { delete sseTransports[transport.sessionId] })
    await server.connect(transport)
  })
  app.post('/messages', async (req, res) => {
    const t = sseTransports[req.query.sessionId]
    if (!t) return res.status(400).json({ error: 'no active SSE session' })
    await t.handlePostMessage(req, res, req.body)
  })

  const port = Number(process.env.MCP_PORT || 8791)
  app.listen(port, () => console.error(`Decoinks reporting MCP (http) on :${port} — /mcp + /sse`))
} else {
  await server.connect(new StdioServerTransport())
  console.error('Decoinks reporting MCP (stdio) ready')
}
