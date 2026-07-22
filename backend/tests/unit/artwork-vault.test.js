const vault = require('../../src/modules/artworks/artwork-vault.service')

describe('Artwork Vault Nextcloud classification', () => {
  test.each([
    ['Leads 2.0/LD-0001/References/photo.png', 'reference'],
    ['Customers/Techno Tees/Ref/logo.ai', 'reference'],
    ['Leads 2.0/LD-0001/Artwork/front-v2.png', 'artwork'],
    ['Leads 2.0/LD-0001/Versions/front_v3.png', 'artwork'],
    ['Customers/Techno Tees/Mockups/shirt.jpg', 'mockup'],
    ['Orders/ORD-001/Gangsheets/22x108.png', 'gangsheet'],
    ['Leads 2.0/LD-0001/sent/approval.jpg', 'sent'],
  ])('%s is classified as %s', (path, expected) => {
    expect(vault.inferType(path)).toBe(expected)
  })
})

describe('Artwork Vault lifecycle naming', () => {
  test.each([
    ['Leads 2.0/260423_Jac_Jean/references/AW-JCA01-0001-SRC.jpg', 'SRC', 'AW-JCA01-0001', 'Source Received'],
    ['Leads 2.0/260423_Jac_Jean/Artworks/AW-JCA01-0001-WRK-V3.ai', 'WRK', 'AW-JCA01-0001', 'In Design'],
    ['Leads 2.0/260423_Jac_Jean/Mockups/AW-JCA01-0001-MOCK.jpg', 'MOCK', 'AW-JCA01-0001', 'Mockup Ready'],
    ['Leads 2.0/260423_Jac_Jean/sent/AW-JCA01-0001-OUT.jpg', 'OUT', 'AW-JCA01-0001', 'Sent to Customer'],
    ['Leads 2.0/260423_Jac_Jean/Gangsheets/AW-JCA01-0001-FNL.pdf', 'FNL', 'AW-JCA01-0001', 'Production Ready'],
  ])('infers lifecycle identity for %s', (path, lifecycle, code, status) => {
    const fileName = path.split('/').pop()
    expect(vault.inferLifecycle(path, fileName)).toBe(lifecycle)
    expect(vault.inferArtworkCode(fileName)).toBe(code)
    expect(vault.inferStatus(lifecycle)).toBe(status)
  })

  test('documents remain outside the visual artwork index', () => {
    expect(vault.inferLifecycle('Leads 2.0/260423_Jac_Jean/Documents/invoice.pdf', 'invoice.pdf')).toBeNull()
    expect(vault.inferType('Leads 2.0/260423_Jac_Jean/Documents/invoice.pdf')).toBeNull()
  })

  test('version is revision metadata instead of a separate type', () => {
    expect(vault.inferVersion('AW-JCA01-0001-WRK-V12.ai')).toBe(12)
    expect(vault.inferType('Leads/Customer/Versions/AW-JCA01-0001-WRK-V12.ai')).toBe('artwork')
  })
})

describe('Artwork Vault order classification', () => {
  test.each([
    ['Orders/ORD-001/Gangsheets/22x108.png', 'gangsheet'],
    ['Leads/Customer/DTF Transfers/logo.png', 'dtf'],
    ['Customers/Techno Tees/Custom Shirts/front.png', 'apparel'],
    ['Customers/Techno Tees/References/logo.png', null],
  ])('%s has order type %s', (path, expected) => {
    expect(vault.inferOrderType(path)).toBe(expected)
  })
})
