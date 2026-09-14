'use strict'

jest.mock('../../src/config/db', () => ({
  query: jest.fn(),
}))

const db = require('../../src/config/db')
const svc = require('../../src/modules/customer-portal/portal.service')

const CUSTOMER = '11111111-1111-4111-8111-111111111111'

beforeEach(() => jest.clearAllMocks())

// The Artworks screen lists designs with no vault file under ids like
// "item:<name>"; asking for such an id used to reach Postgres as a uuid and
// came back as a 500.
describe('getAssetPath()', () => {
  test('an id that is not a UUID is simply not found, without querying', async () => {
    await expect(svc.getAssetPath(CUSTOMER, 'item:dtf transfers - 54 pcs, 4 designs')).resolves.toBeNull()
    await expect(svc.getAssetPath(CUSTOMER, 'AW-26082494-1')).resolves.toBeNull()
    await expect(svc.getAssetPath(CUSTOMER, undefined)).resolves.toBeNull()
    expect(db.query).not.toHaveBeenCalled()
  })

  test('a UUID is looked up scoped to the customer', async () => {
    const id = '22222222-2222-4222-8222-222222222222'
    const row = { path: '/x.png', file_name: 'x.png', mime_type: 'image/png' }
    db.query.mockResolvedValueOnce({ rows: [row] })

    await expect(svc.getAssetPath(CUSTOMER, id)).resolves.toEqual(row)
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('customer_id = $2'), [id, CUSTOMER])
  })

  test('a UUID the customer does not own is not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    await expect(svc.getAssetPath(CUSTOMER, '33333333-3333-4333-8333-333333333333')).resolves.toBeNull()
  })
})
