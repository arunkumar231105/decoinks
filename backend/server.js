require('dotenv').config()
const app  = require('./src/app')
const port = process.env.PORT || 8000

app.listen(port, async () => {
  console.log(`Decoinks backend running on port ${port}`)
  try {
    const { ensureBucket } = require('./src/config/storage')
    await ensureBucket()
    console.log('MinIO bucket ready')
  } catch (e) {
    console.warn('MinIO storage not available (uploads will fail):', e.message)
  }
})
