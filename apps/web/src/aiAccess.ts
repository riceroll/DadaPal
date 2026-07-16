import encryptedKey from './ai-key.encrypted.json'

type EncryptedKey = typeof encryptedKey

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

export async function unlockOpenRouterKey(password: string) {
  const bundle = encryptedKey as EncryptedKey
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(bundle.salt), iterations: bundle.iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const payload = new Uint8Array([...fromBase64(bundle.ciphertext), ...fromBase64(bundle.authTag)])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(bundle.iv) }, key, payload)
  return decoder.decode(plain)
}

export async function askOpenRouter<T>(apiKey: string, prompt: string, maxTokens: number) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'DadaPal Beta',
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      reasoning: { effort: 'none' },
      max_tokens: maxTokens,
    }),
  })
  if (!response.ok) throw new Error('OpenRouter request failed')
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter returned no content')
  return JSON.parse(content) as T
}
