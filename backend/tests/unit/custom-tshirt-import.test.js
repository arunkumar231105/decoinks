const { buildLines, parseAddress, validateRows } = require('../../scripts/import-custom-tshirt-orders')

const baseRow = {
  Customer: 'Test Customer',
  Phone: '7147901460',
  Address: '123 Main St, Corona, CA 92881, US',
  Product: 'T-Shirts',
  Color: 'Navy',
  Print: 'Front',
  'Size Breakdown': 'L:2, XXL:2',
  Qty: 4,
  Shipping: 15,
  'Total Received': 95,
}

describe('Custom T-Shirt workbook importer', () => {
  test('parses US address fields without losing street details', () => {
    expect(parseAddress('2331 W 11th Street, Apt 4G, Brooklyn, NY 11223, US')).toEqual({
      address_line1: '2331 W 11th Street, Apt 4G',
      city: 'Brooklyn',
      state: 'NY',
      zip: '11223',
      country: 'United States',
    })
  })

  test('creates one apparel line per supplied size and preserves totals', () => {
    const lines = buildLines(baseRow)
    expect(lines.map(({ size, qty }) => ({ size, qty }))).toEqual([
      { size: 'L', qty: 2 },
      { size: 'XXL', qty: 2 },
    ])
    expect(lines.reduce((sum, line) => sum + line.qty, 0)).toBe(4)
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(80)
  })

  test('splits mixed shirt and hoodie quantities into their proper categories', () => {
    const lines = buildLines({
      ...baseRow,
      Product: '6 T-Shirts + 2 Hoodies',
      Color: 'Not specified',
      Print: 'Front & Back',
      'Size Breakdown': 'T-Shirts L:2, XL:2, XXL:2 | Hoodies L:1, XL:1',
      Qty: 8,
      Shipping: 15,
      'Total Received': 127,
    })
    expect(lines.map(({ category, size, qty }) => ({ category, size, qty }))).toEqual([
      { category: 'T-Shirt', size: 'L', qty: 2 },
      { category: 'T-Shirt', size: 'XL', qty: 2 },
      { category: 'T-Shirt', size: 'XXL', qty: 2 },
      { category: 'Hoodie', size: 'L', qty: 1 },
      { category: 'Hoodie', size: 'XL', qty: 1 },
    ])
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(112)
  })

  test('uses size-prefixed colors as individual source line items', () => {
    const lines = buildLines({
      ...baseRow,
      Color: 'XL Orange, XL Blue, XXL Orange, XXL Blue',
      'Size Breakdown': 'XL:2, XXL:2',
      Qty: 4,
      Shipping: 15,
      'Total Received': 105,
    })
    expect(lines.map(({ size, color }) => ({ size, color }))).toEqual([
      { size: 'XL', color: 'Orange' },
      { size: 'XL', color: 'Blue' },
      { size: 'XXL', color: 'Orange' },
      { size: 'XXL', color: 'Blue' },
    ])
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(90)
  })

  test('preserves an under-specified quantity without inventing a size', () => {
    const lines = buildLines({ ...baseRow, Qty: 5 })
    expect(lines).toHaveLength(3)
    expect(lines[2]).toMatchObject({ size: null, qty: 1, source_warning: 'Size breakdown accounted for 4 of 5 pieces' })
    expect(lines.reduce((sum, line) => sum + line.qty, 0)).toBe(5)
  })

  test('rejects a size breakdown that exceeds the source quantity', () => {
    expect(() => buildLines({ ...baseRow, Qty: 3 })).toThrow('size quantities total 4, exceed expected 3')
  })

  test('normalizes a validated source row and gives it an idempotency key', () => {
    const [row] = validateRows([baseRow])
    expect(row.Phone).toBe('7147901460')
    expect(row.sourceKey).toBe('custom-tshirt-po-orders:row:2:test-customer')
    expect(row.lines).toHaveLength(2)
  })
})
