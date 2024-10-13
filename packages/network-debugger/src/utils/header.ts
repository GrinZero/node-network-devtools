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
