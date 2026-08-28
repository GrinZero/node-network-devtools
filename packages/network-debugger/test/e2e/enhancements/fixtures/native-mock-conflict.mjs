import { pathToFileURL } from 'node:url'

const entryPath = process.env.NETWORK_DEBUGGER_E2E_ENTRY
if (!entryPath) throw new Error('NETWORK_DEBUGGER_E2E_ENTRY is required')

const { register } = await import(pathToFileURL(entryPath).href)
try {
  register({
    mode: 'native',
    legacy: {
      mock: [{ match: { url: 'http://127.0.0.1/*' }, response: { body: 'nope' } }]
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
  if (result.code !== 'NND_NATIVE_MOCK_CONFLICT') {
    console.error(JSON.stringify(result))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify(result))
  }
}
