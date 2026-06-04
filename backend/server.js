require('dotenv').config()
const app  = require('./src/app')
const { ensureBucket } = require('./src/config/storage')
const port = process.env.PORT || 8000

app.listen(port, async () => {
  console.log(`Decoinks backend running on port ${port}`)
  try {
    await ensureBucket()
    console.log('MinIO bucket ready')
  } catch (e) {
    console.warn('MinIO not available — file uploads will fail until MinIO is running:', e.message)
  }
})
