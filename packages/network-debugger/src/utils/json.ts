export const jsonParse = <F extends any, T = F>(str: string, fallback?: F) => {
  try {
    return JSON.parse(str) as T
  } catch (e) {
    return fallback as F
  }
}
