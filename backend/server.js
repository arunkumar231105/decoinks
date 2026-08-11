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
  // Keeps the Artwork Vault current with Nextcloud without anyone pressing
  // Sync. Set NEXTCLOUD_DELTA_WATCH=false to disable.
  try {
    const vault = require('./src/modules/artworks/artwork-vault.service')
    console.log(vault.startWatcher() ? 'Artwork vault live watcher started' : 'Artwork vault live watcher disabled')
  } catch (e) {
    console.warn('Artwork vault live watcher could not start:', e.message)
  }
})
