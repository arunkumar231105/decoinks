// Unit cover for the Drive artwork picker. Everything here is offline: the
// cases are the two things that must not drift — which files the picker offers
// to attach, and the refusal of any path outside the artwork folder (refs come
// back from the browser, so they are untrusted input).

process.env.GOOGLE_DRIVE_RCLONE_URL = 'http://127.0.0.1:1'   // never called
process.env.GOOGLE_DRIVE_ROOT_FOLDER = 'DECOINKS_ORDERS'

const gdrive = require('../../src/modules/gdrive/gdrive.service')
const rclone = require('../../src/modules/gdrive/rclone.transport')

describe('Drive picker — customer folder matching', () => {
  test.each([
    ['Kyle Morris', 'kylemorris'],
    ['kyle  morris.', 'kylemorris'],
    ['Kyle_Morris', 'kylemorris'],
    ["O'Brien & Sons", 'obriensons'],
  ])('%s normalises to %s', (input, expected) => {
    expect(gdrive.normalizeName(input)).toBe(expected)
  })
})

describe('Drive picker — attachable files', () => {
  test.each([
    [{ name: 'front.png', mime_type: 'image/png' }, true],
    [{ name: 'AW-KMO01-0021-OUT.PNG', mime_type: null }, true],
    [{ name: 'sheet.jpg', mime_type: 'image/jpeg' }, true],
    [{ name: 'art.webp', mime_type: 'image/webp' }, true],
    [{ name: 'scan.tif', mime_type: 'image/tiff' }, true],
    // Design and document files live in the same folders but cannot become an
    // order-line thumbnail — the size detection runs them through sharp.
    [{ name: 'master.psd', mime_type: 'image/vnd.adobe.photoshop' }, false],
    [{ name: 'logo.ai', mime_type: 'application/postscript' }, false],
    [{ name: 'PO Number_ TSI 260517-15.docx', mime_type: null }, false],
    [{ name: 'proof.pdf', mime_type: 'application/pdf' }, false],
  ])('%o attachable: %s', (file, expected) => {
    expect(gdrive.isAttachable(file)).toBe(expected)
  })
})

describe('Drive picker — refs are confined to the artwork folder', () => {
  test.each([
    ['../../etc/passwd', 400],
    ['DECOINKS_ORDERS/../secrets/pay.png', 400],
    ['', 400],
    ['Personal Photos/holiday.png', 403],
    ['DECOINKS_ORDERS_OLD/leak.png', 403],
  ])('%s is refused with %i', async (ref, status) => {
    await expect(rclone.getMeta(ref)).rejects.toMatchObject({ statusCode: status })
    await expect(rclone.download(ref)).rejects.toMatchObject({ statusCode: status })
  })

  test('a path inside the root passes the guard and only then reaches the bridge', async () => {
    // The bridge address points nowhere, so getting past the guard shows up as
    // a connection failure (502/504) rather than a 400/403 refusal.
    await expect(rclone.getMeta('DECOINKS_ORDERS/Kyle Morris/_Artworks/front.png'))
      .rejects.toMatchObject({ statusCode: expect.not.stringMatching(/^(400|403)$/) })
  })
})

describe('Drive picker — unconfigured server', () => {
  test('status explains what is missing instead of throwing', async () => {
    const url = process.env.GOOGLE_DRIVE_RCLONE_URL
    delete process.env.GOOGLE_DRIVE_RCLONE_URL
    try {
      const result = await gdrive.status()
      expect(result).toMatchObject({ configured: false, ok: false, mode: 'none' })
      expect(result.message).toMatch(/GOOGLE_DRIVE_RCLONE_URL/)
    } finally {
      process.env.GOOGLE_DRIVE_RCLONE_URL = url
    }
  })
})
