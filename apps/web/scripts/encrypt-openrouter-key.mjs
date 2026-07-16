import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

const apiKey = process.env.OPENROUTER_API_KEY
const password = process.env.DADAPAL_ACCESS_PASSWORD

if (!apiKey || !password) {
  throw new Error('Set OPENROUTER_API_KEY and DADAPAL_ACCESS_PASSWORD before generating the encrypted key file.')
}

const salt = randomBytes(16)
const iv = randomBytes(12)
const key = pbkdf2Sync(password, salt, 210_000, 32, 'sha256')
const cipher = createCipheriv('aes-256-gcm', key, iv)
const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
const authTag = cipher.getAuthTag()
const output = {
  version: 1,
  kdf: 'PBKDF2-SHA256',
  iterations: 210_000,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ciphertext: ciphertext.toString('base64'),
  authTag: authTag.toString('base64'),
}

mkdirSync(new URL('../src/', import.meta.url), { recursive: true })
writeFileSync(new URL('../src/ai-key.encrypted.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`)
console.log('Generated encrypted browser AI key bundle.')
