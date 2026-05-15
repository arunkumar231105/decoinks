const { google } = require('googleapis')
const fs = require('fs')
const path = require('path')

function getDriveClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL
  const privateKey  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')

  if (!clientEmail || !privateKey) return null

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })

  return google.drive({ version: 'v3', auth })
}

/**
 * Upload a local file to Google Drive.
 * Returns the shareable public URL on success, null on failure.
 */
async function uploadToDrive(localFilePath, originalName, mimeType) {
  const drive = getDriveClient()
  if (!drive) return null

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  const fileStream = fs.createReadStream(localFilePath)

  const response = await drive.files.create({
    requestBody: {
      name: `${Date.now()}_${path.basename(originalName)}`,
      parents: folderId ? [folderId] : [],
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: fileStream,
    },
    fields: 'id, webViewLink, webContentLink',
  })

  const fileId = response.data.id

  // Make file publicly readable
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  // Direct download/view link
  return `https://drive.google.com/uc?id=${fileId}`
}

module.exports = { uploadToDrive }
