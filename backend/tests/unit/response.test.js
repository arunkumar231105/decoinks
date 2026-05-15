'use strict'

const { success, created, error, paginated } = require('../../src/utils/response')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json   = jest.fn().mockReturnValue(res)
  return res
}

// ─── success() ───────────────────────────────────────────────────────────────

describe('success()', () => {
  test('sends 200 with success:true, data, and default message', () => {
    const res = mockRes()
    success(res, { id: 1 })

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'OK',
      data: { id: 1 },
    })
  })

  test('uses provided statusCode and message', () => {
    const res = mockRes()
    success(res, { id: 2 }, 'Customer created', 201)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Customer created',
      data: { id: 2 },
    })
  })

  test('accepts null data', () => {
    const res = mockRes()
    success(res, null, 'Logged out')

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: null })
    )
  })
})

// ─── created() ───────────────────────────────────────────────────────────────

describe('created()', () => {
  test('sends 201 with success:true and default message', () => {
    const res = mockRes()
    created(res, { id: 'abc' })

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Created',
      data: { id: 'abc' },
    })
  })

  test('uses a custom message', () => {
    const res = mockRes()
    created(res, { id: 'xyz' }, 'Order created')

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Order created' })
    )
  })
})

// ─── error() ─────────────────────────────────────────────────────────────────

describe('error()', () => {
  test('sends 400 with success:false and default message', () => {
    const res = mockRes()
    error(res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'An error occurred',
    })
  })

  test('uses provided statusCode and message', () => {
    const res = mockRes()
    error(res, 'Not found', 404)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Not found',
    })
  })

  test('sends 422 for validation errors', () => {
    const res = mockRes()
    error(res, 'Validation failed', 422)

    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Validation failed' })
    )
  })

  test('includes details when provided', () => {
    const res = mockRes()
    const details = [{ field: 'email', message: 'Invalid email' }]
    error(res, 'Validation failed', 422, details)

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Validation failed',
      details,
    })
  })

  test('omits details key when details is null', () => {
    const res = mockRes()
    error(res, 'Bad request', 400, null)

    const body = res.json.mock.calls[0][0]
    expect(body).not.toHaveProperty('details')
  })
})

// ─── paginated() ─────────────────────────────────────────────────────────────

describe('paginated()', () => {
  test('sends 200 with full pagination envelope', () => {
    const res = mockRes()
    paginated(res, [{ id: 1 }, { id: 2 }], 20, 1, 10)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        rows:       [{ id: 1 }, { id: 2 }],
        total:      20,
        page:       1,
        limit:      10,
        totalPages: 2,
        hasNext:    true,
        hasPrev:    false,
      },
    })
  })

  test('calculates totalPages correctly — ceil(25/10) = 3', () => {
    const res = mockRes()
    paginated(res, [], 25, 2, 10)

    const { data } = res.json.mock.calls[0][0]
    expect(data.totalPages).toBe(3)
  })

  test('totalPages = 1 when total fits in one page', () => {
    const res = mockRes()
    paginated(res, [], 5, 1, 10)

    const { data } = res.json.mock.calls[0][0]
    expect(data.totalPages).toBe(1)
    expect(data.hasNext).toBe(false)
    expect(data.hasPrev).toBe(false)
  })

  test('hasNext is false on last page', () => {
    const res = mockRes()
    paginated(res, [], 30, 3, 10)

    const { data } = res.json.mock.calls[0][0]
    expect(data.hasNext).toBe(false)
    expect(data.hasPrev).toBe(true)
  })

  test('hasPrev is false on first page', () => {
    const res = mockRes()
    paginated(res, [], 30, 1, 10)

    const { data } = res.json.mock.calls[0][0]
    expect(data.hasPrev).toBe(false)
  })

  test('coerces string page/limit/total to numbers', () => {
    const res = mockRes()
    paginated(res, [], '50', '2', '10')

    const { data } = res.json.mock.calls[0][0]
    expect(data.total).toBe(50)
    expect(data.page).toBe(2)
    expect(data.limit).toBe(10)
  })

  test('totalPages = 0 when total is 0', () => {
    const res = mockRes()
    paginated(res, [], 0, 1, 10)

    const { data } = res.json.mock.calls[0][0]
    expect(data.totalPages).toBe(0)
    expect(data.hasNext).toBe(false)
  })
})
