export const converHeaderText = (base = '', headers: Record<string, unknown>) => {
  const headerText =
    base +
    Object.keys(headers)
      .map((key) => {
        return `${key}: ${headers[key]}`
      })
      .join('\r\n')
  return headerText
}

export const convertRawHeaders = (rawHeaders: string[]) => {
  const headers: Record<string, unknown> = {}
  for (let i = 0; i < rawHeaders.length; i += 2) {
    headers[rawHeaders[i]] = rawHeaders[i + 1]
  }
  return headers
}
