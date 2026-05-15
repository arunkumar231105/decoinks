function success(res, data, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data })
}

function created(res, data, message = 'Created') {
  return res.status(201).json({ success: true, message, data })
}

function error(res, message = 'An error occurred', statusCode = 400, details = null) {
  const body = { success: false, message }
  if (details) body.details = details
  return res.status(statusCode).json(body)
}

function paginated(res, rows, total, page, limit) {
  const totalPages = Math.ceil(total / limit)
  return res.status(200).json({
    success: true,
    data: {
      rows,
      total:      Number(total),
      page:       Number(page),
      limit:      Number(limit),
      totalPages,
      hasNext:    Number(page) < totalPages,
      hasPrev:    Number(page) > 1,
    },
  })
}

module.exports = { success, created, error, paginated }
