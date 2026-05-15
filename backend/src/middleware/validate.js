const { ZodError } = require('zod')

function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body)
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }))
        return res.status(422).json({
          success: false,
          message: 'Validation failed',
          details,
        })
      }
      next(err)
    }
  }
}

function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query)
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(422).json({
          success: false,
          message: 'Invalid query parameters',
          details: err.errors,
        })
      }
      next(err)
    }
  }
}

module.exports = { validate, validateQuery }
