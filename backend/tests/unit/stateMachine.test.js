'use strict'

const {
  canTransition,
  validateTransition,
  getValidTransitions,
} = require('../../src/utils/stateMachine')

// ── canTransition ─────────────────────────────────────────────────────────────

describe('canTransition', () => {
  test('Admin can perform any valid edge regardless of role restriction', () => {
    // These edges exist in the map but are normally Manager-only
    expect(canTransition('quotation', 'Draft', 'Approved', 'Admin')).toBe(true)
    expect(canTransition('invoice',   'Sent',  'Paid',     'Admin')).toBe(true)
    expect(canTransition('order',     'QC',    'Ready to Ship', 'Admin')).toBe(true)
  })

  test('valid role returns true', () => {
    expect(canTransition('quotation', 'Draft', 'Sent',     'Sales')).toBe(true)
    expect(canTransition('quotation', 'Sent',  'Approved', 'Manager')).toBe(true)
    expect(canTransition('invoice',   'Sent',  'Paid',     'Manager')).toBe(true)
    expect(canTransition('order',     'Confirmed', 'In Production', 'Production')).toBe(true)
    expect(canTransition('po',        'Sent',  'Accepted', 'supplier')).toBe(true)
  })

  test('wrong role returns false', () => {
    expect(canTransition('quotation', 'Draft', 'Sent',  'Production')).toBe(false)
    expect(canTransition('invoice',   'Sent',  'Paid',  'Sales')).toBe(false)
    expect(canTransition('order',     'Confirmed', 'In Production', 'Sales')).toBe(false)
  })

  test('valid edge but wrong role returns false', () => {
    // Draft → Approved IS in quotation map but requires Manager, not Sales
    expect(canTransition('quotation', 'Draft', 'Approved', 'Sales')).toBe(false)
  })

  test('non-existent edge returns false even for Admin', () => {
    expect(canTransition('invoice',   'Paid',  'Draft',    'Admin')).toBe(false)
    expect(canTransition('order',     'Delivered', 'Draft','Admin')).toBe(false)
  })

  test('unknown entity returns false even for Admin', () => {
    expect(canTransition('widget', 'Draft', 'Active', 'Admin')).toBe(false)
  })
})

// ── validateTransition ────────────────────────────────────────────────────────

describe('validateTransition', () => {
  const admin   = { id: 'u1', role: 'Admin' }
  const sales   = { id: 'u2', role: 'Sales' }
  const manager = { id: 'u3', role: 'Manager' }
  const prod    = { id: 'u4', role: 'Production' }
  const supplier = { id: 'u5', role: 'supplier' }

  test('valid transition does not throw', () => {
    expect(() => validateTransition('quotation', 'Draft', 'Sent', sales)).not.toThrow()
    expect(() => validateTransition('invoice',   'Sent',  'Paid', manager)).not.toThrow()
    expect(() => validateTransition('order',     'QC',    'Ready to Ship', prod)).not.toThrow()
    expect(() => validateTransition('po',        'Sent',  'Accepted', supplier)).not.toThrow()
  })

  test('Admin bypasses role restrictions for valid edges', () => {
    // Sent → Approved is a Manager-only edge; Admin can do it
    expect(() => validateTransition('quotation', 'Sent', 'Approved', admin)).not.toThrow()
    expect(() => validateTransition('order',   'Draft', 'Confirmed', admin)).not.toThrow()
  })

  test('Admin cannot perform non-existent transitions (throws 422)', () => {
    // Draft → Paid has no direct edge in INVOICE_TRANSITIONS
    let err
    try { validateTransition('invoice', 'Draft', 'Paid', admin) }
    catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.status).toBe(422)
  })

  test('wrong role on valid edge throws 403 (not 422)', () => {
    // Draft → Approved IS in the map but requires Manager; Sales gets 403
    let err
    try { validateTransition('quotation', 'Draft', 'Approved', sales) }
    catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.status).toBe(403)
  })

  test('non-existent edge throws 422', () => {
    // Paid → anything is terminal — no edges
    let err
    try { validateTransition('invoice', 'Paid', 'Draft', manager) }
    catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.status).toBe(422)
    expect(err.message).toMatch(/invalid transition/i)
  })

  test('skipping a status throws 422 (Draft → Overdue skips Sent)', () => {
    let err
    try { validateTransition('invoice', 'Draft', 'Overdue', manager) }
    catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.status).toBe(422)
  })

  test('wrong role throws 403 with role message', () => {
    let err
    try { validateTransition('invoice', 'Sent', 'Paid', sales) }
    catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.status).toBe(403)
    expect(err.message).toMatch(/Sales/i)
  })

  test('Production cannot change invoice status', () => {
    let err
    try { validateTransition('invoice', 'Sent', 'Overdue', prod) }
    catch (e) { err = e }
    expect(err.status).toBe(403)
  })

  test('Sales cannot mark order Delivered', () => {
    let err
    try { validateTransition('order', 'Shipped', 'Delivered', sales) }
    catch (e) { err = e }
    expect(err.status).toBe(403)
  })

  test('unknown entity type throws 400', () => {
    let err
    try { validateTransition('widget', 'Draft', 'Active', admin) }
    catch (e) { err = e }
    expect(err.status).toBe(400)
  })

  test('unknown current status throws 422', () => {
    let err
    try { validateTransition('order', 'Ghost', 'Confirmed', admin) }
    catch (e) { err = e }
    expect(err.status).toBe(422)
  })
})

// ── getValidTransitions ───────────────────────────────────────────────────────

describe('getValidTransitions', () => {
  test('Sales from Draft quote sees only Sent', () => {
    const t = getValidTransitions('quotation', 'Draft', 'Sales')
    expect(t).toContain('Sent')
    expect(t).not.toContain('Approved')
    expect(t).not.toContain('Rejected')
  })

  test('Manager from Draft quote sees Sent, Approved, Rejected, Expired', () => {
    const t = getValidTransitions('quotation', 'Draft', 'Admin')
    expect(t).toEqual(expect.arrayContaining(['Sent', 'Approved', 'Rejected', 'Expired']))
  })

  test('Production from In Production order sees QC only', () => {
    const t = getValidTransitions('order', 'In Production', 'Production')
    expect(t).toEqual(['QC'])
  })

  test('Admin sees all valid next statuses', () => {
    const t = getValidTransitions('invoice', 'Sent', 'Admin')
    expect(t).toEqual(expect.arrayContaining(['Paid', 'Partially Paid', 'Overdue', 'Void']))
  })

  test('unknown entity returns empty array', () => {
    expect(getValidTransitions('widget', 'Draft', 'Admin')).toEqual([])
  })

  test('terminal status returns empty array', () => {
    expect(getValidTransitions('invoice', 'Paid', 'Admin')).toEqual([])
    expect(getValidTransitions('order', 'Delivered', 'Admin')).toEqual([])
  })

  test('supplier sees only their PO transitions', () => {
    const t = getValidTransitions('po', 'Sent', 'supplier')
    expect(t).toContain('Accepted')
    expect(t).not.toContain('Cancelled') // only Manager can cancel
  })
})
