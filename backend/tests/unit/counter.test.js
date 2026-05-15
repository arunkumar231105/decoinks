'use strict'

jest.mock('../../src/config/db', () => ({
  pool: { connect: jest.fn() },
}))

const { pool } = require('../../src/config/db')
const { getNextNumber } = require('../../src/utils/counter')

function makeClient(maxSeq) {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  }
  client.query
    .mockResolvedValueOnce({})                           // BEGIN
    .mockResolvedValueOnce({})                           // pg_advisory_xact_lock
    .mockResolvedValueOnce({ rows: [{ max_seq: maxSeq }] }) // SELECT MAX
    .mockResolvedValueOnce({})                           // COMMIT
  return client
}

beforeEach(() => jest.clearAllMocks())

describe('getNextNumber()', () => {
  test('returns PREFIX-YEAR-0001 when no rows exist (max_seq = 0)', async () => {
    const year = new Date().getFullYear()
    pool.connect.mockResolvedValue(makeClient(0))

    const result = await getNextNumber('ORD', 'orders', 'order_number')

    expect(result).toBe(`ORD-${year}-0001`)
  })

  test('returns PREFIX-YEAR-0042 when max_seq = 41', async () => {
    const year = new Date().getFullYear()
    pool.connect.mockResolvedValue(makeClient(41))

    const result = await getNextNumber('ORD', 'orders', 'order_number')

    expect(result).toBe(`ORD-${year}-0042`)
  })

  test('pads sequence to 4 digits', async () => {
    const year = new Date().getFullYear()
    pool.connect.mockResolvedValue(makeClient(9))

    const result = await getNextNumber('LEAD', 'leads', 'lead_number')

    expect(result).toBe(`LEAD-${year}-0010`)
  })

  test('embeds the correct year from system clock', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2027-03-15T10:00:00Z'))

    pool.connect.mockResolvedValue(makeClient(0))

    const result = await getNextNumber('SHP', 'shipments', 'shipment_number')

    expect(result).toMatch(/^SHP-2027-/)

    jest.useRealTimers()
  })

  test('rolls over year correctly — 2025 vs 2027', async () => {
    jest.useFakeTimers()

    // Use mid-year dates to avoid timezone edge cases at year boundaries
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    pool.connect.mockResolvedValue(makeClient(5))
    const result2025 = await getNextNumber('INV', 'invoices', 'invoice_number')
    expect(result2025).toBe('INV-2025-0006')

    jest.setSystemTime(new Date('2027-06-15T12:00:00Z'))
    pool.connect.mockResolvedValue(makeClient(0))
    const result2027 = await getNextNumber('INV', 'invoices', 'invoice_number')
    expect(result2027).toBe('INV-2027-0001')

    jest.useRealTimers()
  })

  test('executes BEGIN and COMMIT', async () => {
    const client = makeClient(0)
    pool.connect.mockResolvedValue(client)

    await getNextNumber('ORD', 'orders', 'order_number')

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  test('releases the client after success', async () => {
    const client = makeClient(0)
    pool.connect.mockResolvedValue(client)

    await getNextNumber('ORD', 'orders', 'order_number')

    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('rolls back and releases client on DB error', async () => {
    const client = {
      query: jest.fn(),
      release: jest.fn(),
    }
    client.query
      .mockResolvedValueOnce({})          // BEGIN
      .mockResolvedValueOnce({})          // advisory lock
      .mockRejectedValueOnce(new Error('DB error')) // SELECT MAX fails
    pool.connect.mockResolvedValue(client)

    await expect(
      getNextNumber('ORD', 'orders', 'order_number')
    ).rejects.toThrow('DB error')

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('works with different prefixes independently', async () => {
    const year = new Date().getFullYear()

    pool.connect.mockResolvedValue(makeClient(99))
    const ord = await getNextNumber('ORD', 'orders', 'order_number')
    expect(ord).toBe(`ORD-${year}-0100`)

    pool.connect.mockResolvedValue(makeClient(0))
    const qt = await getNextNumber('QT', 'quotations', 'quote_number')
    expect(qt).toBe(`QT-${year}-0001`)
  })
})
