import { createPlugin, useHandler } from '../common'

export const healthPlugin = createPlugin('health', ({ devtool }) => {
  const exitProcess = () => {
    process.exit(0)
  }

  let id = setTimeout(exitProcess, 5000)
  useHandler('healthcheck', () => {
    clearTimeout(id)
    id = setTimeout(exitProcess, 5000)
  })
})
