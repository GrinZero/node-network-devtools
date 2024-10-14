export const formatHeadersToHeaderText = (base: string, headers: Record<string, unknown>) =>
  base +
  Object.entries(headers)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\r\n')

export const parseRawHeaders = (rawHeaders: string[]) =>
  rawHeaders.reduce(
    (acc, _, index, arr) => (index % 2 === 0 ? { ...acc, [arr[index]]: arr[index + 1] } : acc),
    {}
  )

export const stringifyNestedObj = (obj: { [x: string]: any }) =>
  Object.keys(obj).reduce((acc: Record<string, unknown>, key) => {
    const value = obj[key]
    acc[key] =
      typeof value === 'object' && value !== null ? stringifyNestedObj(value) : String(value)
    return acc
  }, {})

export const getTimestamp = () => new Date().getTime() / 1000
