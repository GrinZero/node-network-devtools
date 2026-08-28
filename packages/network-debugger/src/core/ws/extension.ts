type ExtensionParameter = string | true
type ExtensionParameters = Record<string, ExtensionParameter[]>

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function splitOutsideQuotes(value: string, delimiter: ',' | ';'): string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  let escaped = false

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quoted && character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && character === delimiter) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }

  if (quoted || escaped) throw new SyntaxError('Invalid Sec-WebSocket-Extensions header')
  parts.push(value.slice(start))
  return parts
}

function parseToken(value: string): string {
  const token = value.trim()
  if (!TOKEN.test(token)) throw new SyntaxError('Invalid Sec-WebSocket-Extensions token')
  return token
}

function parseValue(value: string): string {
  const candidate = value.trim()
  if (!candidate.startsWith('"')) return parseToken(candidate)
  if (!candidate.endsWith('"') || candidate.length < 3) {
    throw new SyntaxError('Invalid Sec-WebSocket-Extensions quoted value')
  }

  let result = ''
  let escaped = false
  for (const character of candidate.slice(1, -1)) {
    if (escaped) {
      result += character
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else {
      result += character
    }
  }
  if (escaped || !TOKEN.test(result)) {
    throw new SyntaxError('Invalid Sec-WebSocket-Extensions quoted value')
  }
  return result
}

/**
 * Parse the negotiated permessage-deflate response parameters. The HTTP
 * upgrade is observed below the WebSocket implementation, so capture needs an
 * independent, transport-only view of the negotiated extension.
 */
export function parsePerMessageDeflate(
  header: string | readonly string[] | undefined
): ExtensionParameters[] | undefined {
  if (header === undefined) return undefined
  const configurations: ExtensionParameters[] = []

  for (const extension of splitOutsideQuotes(
    typeof header === 'string' ? header : header.join(','),
    ','
  )) {
    const fields = splitOutsideQuotes(extension, ';')
    const name = parseToken(fields.shift() ?? '').toLowerCase()
    if (name !== 'permessage-deflate') continue

    const parameters: ExtensionParameters = Object.create(null)
    for (const field of fields) {
      const equals = field.indexOf('=')
      const parameterName = parseToken(equals === -1 ? field : field.slice(0, equals)).toLowerCase()
      const parameterValue = equals === -1 ? true : parseValue(field.slice(equals + 1))
      ;(parameters[parameterName] ??= []).push(parameterValue)
    }
    configurations.push(parameters)
  }

  return configurations.length > 0 ? configurations : undefined
}
