'use strict'

/**
 * The shop runs on Pakistan time, and these tests keep it that way.
 *
 * Both failures they guard against happened (2026-09-16): the dashboard counted
 * UTC days, so Daily leads read 11 against 36 in the CRM, and payments made
 * between midnight and 05:00 in Pakistan — Zelle and Stripe — were booked on the
 * previous date. See src/utils/shopTime.js.
 */

const fs = require('fs')
const path = require('path')

jest.mock('../../src/config/redis', () => ({ cacheGet: jest.fn(async () => null), cacheSet: jest.fn(async () => {}) }))

const { shopDate, SQL_SHOP_TODAY } = require('../../src/utils/shopTime')

const ROOT = path.join(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

afterEach(() => { jest.useRealTimers() })

describe('a shop day is a Pakistan day', () => {
  test('the day changes at 19:00 UTC, not at midnight UTC', () => {
    expect(shopDate('2026-09-15T18:59:59Z')).toBe('2026-09-15')
    expect(shopDate('2026-09-15T19:00:00Z')).toBe('2026-09-16')
    expect(shopDate('2026-09-16T05:00:34Z')).toBe('2026-09-16')   // PAY-2026-0164, a Zelle at 10:00 Pakistan time
    expect(shopDate('2026-09-15T22:52:02Z')).toBe('2026-09-16')   // PAY-2026-0163, a Stripe payment at 03:52
  })

  test('Pakistan has no daylight saving: the same rule in winter and summer', () => {
    expect(shopDate('2026-01-15T19:00:00Z')).toBe('2026-01-16')
    expect(shopDate('2026-07-15T18:59:59Z')).toBe('2026-07-15')
  })

  test('something that is not a moment has no day', () => {
    expect(shopDate('not a date')).toBeNull()
  })

  test('SQL today is Pakistan today', () => {
    expect(SQL_SHOP_TODAY).toBe(`(NOW() AT TIME ZONE 'Asia/Karachi')::date`)
  })
})

describe('the dashboard counts Pakistan days', () => {
  test('with no dates given, the period ends today in Pakistan', () => {
    jest.useFakeTimers({ now: new Date('2026-09-15T20:00:00Z') })   // 01:00 on the 16th in Pakistan
    const { resolvePeriod } = require('../../src/modules/dashboard/dashboard.service')
    const p = resolvePeriod()
    expect(p.to).toBe('2026-09-16')
    expect(p.from).toBe('2026-09-01')
  })

  test('every overview query runs with the session clock on Pakistan time', () => {
    const src = read('src/modules/dashboard/dashboard.service.js')
    expect(src).toMatch(/SET TIME ZONE '\$\{SHOP_TZ\}'/)
    const start = src.indexOf('async function getOverview(')
    const end = src.indexOf('\nasync function ', start + 10)
    const body = src.slice(start, end > 0 ? end : undefined)
    expect(body).toMatch(/shopQuery\(`/)
    // A plain query() here would count UTC days again.
    expect(body).not.toMatch(/(^|[^A-Za-z])query\(/)
  })

  test('the dashboard page picks today in Pakistan and weeks from Monday', () => {
    const page = read('../decoinks-frontend/src/pages/DashboardPage.tsx')
    const tabRange = page.slice(page.indexOf('function tabRange('), page.indexOf('function tabRange(') + 900)
    expect(page).toMatch(/const shopToday = \(\) =>[\s\S]*?5 \* 3600 \* 1000/)
    expect(tabRange).toMatch(/const today = shopToday\(\)/)
    expect(tabRange).toMatch(/\(f\.getDay\(\) \+ 6\) % 7/)
  })
})

describe('a payment is dated by the Pakistan day', () => {
  test('a payment recorded without a date (Stripe) gets today in Pakistan', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-15T22:52:02Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    const calls = []
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/config/db', () => ({
        query: jest.fn(async () => ({ rows: [] })),
        getClient: async () => ({
          query: async (text, params) => { calls.push({ text, params }); return { rows: [{ id: 'p1' }] } },
          release: () => {},
        }),
      }))
      jest.doMock('../../src/utils/counter', () => ({ getNextNumber: async () => 'PAY-TEST-0001' }))
      const payments = require('../../src/modules/payments/payments.service')
      await payments.create({ amount: 34, payment_method: 'Stripe', transaction_id: 'pi_test' })
    })
    const insert = calls.find(c => /INSERT INTO payments/.test(c.text))
    expect(insert.params[1]).toBe('2026-09-16')
    expect(insert.text).not.toMatch(/CURRENT_DATE/)
  })

  test('a date typed in by staff is kept as typed', async () => {
    const calls = []
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../src/config/db', () => ({
        query: jest.fn(async () => ({ rows: [] })),
        getClient: async () => ({
          query: async (text, params) => { calls.push({ text, params }); return { rows: [{ id: 'p1' }] } },
          release: () => {},
        }),
      }))
      jest.doMock('../../src/utils/counter', () => ({ getNextNumber: async () => 'PAY-TEST-0002' }))
      const payments = require('../../src/modules/payments/payments.service')
      await payments.create({ amount: 50, payment_method: 'Zelle', payment_date: '2026-09-10' })
    })
    expect(calls.find(c => /INSERT INTO payments/.test(c.text)).params[1]).toBe('2026-09-10')
  })
})

describe('no UTC day slips back into the files that decide a date', () => {
  const FILES = [
    'src/modules/payments/payments.service.js',
    'src/modules/payments/zelle.recorder.js',
    'src/modules/paypal/paypal.recorder.js',
    'src/modules/stripe/stripe.recorder.js',
    'src/modules/dashboard/dashboard.service.js',
  ]
  // Calendar arithmetic on dates built with Date.UTC is fine; reading the clock in UTC is not.
  const ALLOWED = /pure calendar arithmetic, no clock/

  test.each(FILES)('%s', rel => {
    const offending = read(rel).split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && !ALLOWED.test(line))
      .filter(({ line }) =>
        /\bCURRENT_DATE\b/.test(line) ||
        /toISOString\(\)\.(slice\(0,\s*10\)|split\('T'\)\[0\])/.test(line) ||
        /String\([\w.]+\)\.slice\(0,\s*10\)/.test(line) ||
        /timeZone:\s*'America\//.test(line))
      .map(({ line, n }) => `${n}: ${line}`)
    expect(offending).toEqual([])
  })
})
