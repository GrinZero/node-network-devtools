import fs from 'fs'

export const unlinkSafe = (path: string) => {
  try {
    fs.unlinkSync(path)
  } catch {}
}
