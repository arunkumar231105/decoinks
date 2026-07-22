const vault = require('../../src/modules/artworks/artwork-vault.service')

describe('Artwork Vault Nextcloud classification', () => {
  test.each([
    ['Leads 2.0/LD-0001/References/photo.png', 'reference'],
    ['Customers/Techno Tees/Ref/logo.ai', 'reference'],
    ['Leads 2.0/LD-0001/Artwork/front-v2.png', 'artwork'],
    ['Leads 2.0/LD-0001/Versions/front_v3.png', 'version'],
    ['Customers/Techno Tees/Mockups/shirt.jpg', 'mockup'],
    ['Orders/ORD-001/Gangsheets/22x108.png', 'gangsheet'],
  ])('%s is classified as %s', (path, expected) => {
    expect(vault.inferType(path)).toBe(expected)
  })
})
