'use strict'

const { z } = require('zod')
const { validate, validateQuery } = require('../../src/middleware/validate')

function mockReq(body = {}) {
  return { body }
}

function mockQuery(query = {}) {
  return { query }
}

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json   = jest.fn().mockReturnValue(res)
  return res
}

// ─── validate() ──────────────────────────────────────────────────────────────

describe('validate(schema) middleware', () => {
  const schema = z.object({
    name:  z.string(),
    email: z.string().email(),
    age:   z.number().int().positive(),
  })

  test('calls next() when body is valid', () => {
    const req  = mockReq({ name: 'Alice', email: 'alice@example.com', age: 30 })
    const res  = mockRes()
    const next = jest.fn()

    validate(schema)(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith()  // no error argument
    expect(res.status).not.toHaveBeenCalled()
  })

  test('replaces req.body with the parsed (Zod-coerced) value', () => {
    const coercingSchema = z.object({ count: z.coerce.number() })
    const req  = mockReq({ count: '5' })
    const res  = mockRes()
    const next = jest.fn()

    validate(coercingSchema)(req, res, next)

    expect(req.body.count).toBe(5)      // coerced from string to number
    expect(next).toHaveBeenCalled()
  })

  test('returns 422 when required field is missing', () => {
    const req  = mockReq({ name: 'Bob' })  // missing email and age
    const res  = mockRes()
    const next = jest.fn()

    validate(schema)(req, res, next)

    expect(res.status).toHaveBeenCalledWith(422)
    expect(next).not.toHaveBeenCalled()
  })

  test('response body has success:false and message "Validation failed"', () => {
    const req  = mockReq({})
    const res  = mockRes()

    validate(schema)(req, res, jest.fn())

    const body = res.json.mock.calls[0][0]
    expect(body.success).toBe(false)
    expect(body.message).toBe('Validation failed')
  })

  test('details array contains field and message for each error', () => {
    const req  = mockReq({ name: 123, email: 'not-an-email' })  // name wrong type, email invalid, age missing
    const res  = mockRes()

    validate(schema)(req, res, jest.fn())

    const { details } = res.json.mock.calls[0][0]
    expect(Array.isArray(details)).toBe(true)
    expect(details.length).toBeGreaterThan(0)

    // every detail entry must have field and message
    details.forEach(d => {
      expect(d).toHaveProperty('field')
      expect(d).toHaveProperty('message')
      expect(typeof d.field).toBe('string')
      expect(typeof d.message).toBe('string')
    })
  })

  test('details includes the offending field name', () => {
    const req  = mockReq({ name: 'Carol', email: 'bad-email', age: 25 })
    const res  = mockRes()

    validate(schema)(req, res, jest.fn())

    const { details } = res.json.mock.calls[0][0]
    const fields = details.map(d => d.field)
    expect(fields).toContain('email')
  })

  test('passes non-ZodError to next(err)', () => {
    const throwingSchema = {
      parse: () => { throw new TypeError('unexpected') },
    }
    const req  = mockReq({})
    const res  = mockRes()
    const next = jest.fn()

    validate(throwingSchema)(req, res, next)

    expect(next).toHaveBeenCalledWith(expect.any(TypeError))
    expect(res.status).not.toHaveBeenCalled()
  })

  test('strips unknown fields by default (Zod strip mode)', () => {
    const strictSchema = z.object({ name: z.string() })
    const req  = mockReq({ name: 'Dave', extra: 'should-be-stripped' })
    const res  = mockRes()
    const next = jest.fn()

    validate(strictSchema)(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.body).not.toHaveProperty('extra')
  })
})

// ─── validateQuery() ─────────────────────────────────────────────────────────

describe('validateQuery(schema) middleware', () => {
  const querySchema = z.object({
    page:  z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })

  test('calls next() for valid query params', () => {
    const req  = mockQuery({ page: '1', limit: '10' })
    const res  = mockRes()
    const next = jest.fn()

    validateQuery(querySchema)(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith()
  })

  test('coerces string query params to numbers', () => {
    const req  = mockQuery({ page: '3', limit: '25' })
    const res  = mockRes()
    const next = jest.fn()

    validateQuery(querySchema)(req, res, next)

    expect(req.query.page).toBe(3)
    expect(req.query.limit).toBe(25)
  })

  test('returns 422 for invalid query params', () => {
    const req  = mockQuery({ limit: '999' })  // exceeds max 100
    const res  = mockRes()
    const next = jest.fn()

    validateQuery(querySchema)(req, res, next)

    expect(res.status).toHaveBeenCalledWith(422)
    expect(next).not.toHaveBeenCalled()
  })

  test('response message is "Invalid query parameters"', () => {
    const req  = mockQuery({ limit: '999' })
    const res  = mockRes()

    validateQuery(querySchema)(req, res, jest.fn())

    const body = res.json.mock.calls[0][0]
    expect(body.message).toBe('Invalid query parameters')
    expect(body.success).toBe(false)
  })
})
