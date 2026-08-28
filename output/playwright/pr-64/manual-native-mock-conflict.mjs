const packageEntry = new URL(
  './consumer/node_modules/node-network-devtools/dist/index.mjs',
  import.meta.url
)
const { register } = await import(packageEntry.href)

try {
  register({
    mode: 'native',
    legacy: {
      mock: [
        {
          match: { url: 'http://127.0.0.1/*' },
          response: { body: 'must-not-register' }
        }
      ]
    }
  })
  throw new Error('Native plus Mock unexpectedly registered')
} catch (error) {
  const result = {
    name: error?.name,
    code: error?.code,
    message: error?.message,
    details: error?.details
  }

  console.log(JSON.stringify(result, null, 2))
  if (result.code !== 'NND_NATIVE_MOCK_CONFLICT') process.exitCode = 1
}
