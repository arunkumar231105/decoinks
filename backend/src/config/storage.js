const { S3Client, PutObjectCommand, DeleteObjectCommand, CreateBucketCommand, PutBucketPolicyCommand, HeadBucketCommand } = require('@aws-sdk/client-s3')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

const BUCKET     = process.env.MINIO_BUCKET      || 'decoinks'
const PUBLIC_URL = process.env.MINIO_PUBLIC_URL   || 'http://localhost:9000'
const HOST       = process.env.MINIO_HOST         || 'minio'
const PORT       = parseInt(process.env.MINIO_PORT || '9000', 10)
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY   || 'decoinks'
const SECRET_KEY = process.env.MINIO_SECRET_KEY   || 'decoinks_secret_123'

const s3 = new S3Client({
  endpoint: `http://${HOST}:${PORT}`,
  region: 'us-east-1',
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
})

// Run once on startup — create bucket + set public-read policy
async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
    } catch (e) {
      if (e.Code !== 'BucketAlreadyOwnedByYou') throw e
    }
  }
  // Allow anonymous GET on all objects (public read)
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${BUCKET}/*`],
    }],
  })
  await s3.send(new PutBucketPolicyCommand({ Bucket: BUCKET, Policy: policy }))
}

async function uploadFile(buffer, originalname, mimetype, folder = 'uploads') {
  const ext = path.extname(originalname).toLowerCase()
  const key = `${folder}/${uuidv4()}${ext}`
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }))
  return `${PUBLIC_URL}/${BUCKET}/${key}`
}

async function deleteFile(fileUrl) {
  if (!fileUrl) return
  try {
    const prefix = `${PUBLIC_URL}/${BUCKET}/`
    if (!fileUrl.startsWith(prefix)) return
    const key = fileUrl.slice(prefix.length)
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  } catch {
    // Ignore — file may already be gone
  }
}

module.exports = { ensureBucket, uploadFile, deleteFile }
