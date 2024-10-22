import { RequestCenter } from './request-center'
import { PORT, RegisterOptions, SERVER_PORT } from '../common'
import { loadPlugin } from './module'
import { jsonParse } from '../utils'

const options = jsonParse<RegisterOptions>(process.env.NETWORK_OPTIONS || '{}', {})

const loadCenter = () => {
  const main = new RequestCenter({
    serverPort: options.serverPort || SERVER_PORT,
    port: options.port || PORT,
    autoOpenDevtool: options.autoOpenDevtool
  })
  loadPlugin(main)
  return main
}

let main = loadCenter()

let restartCount = 0
const restartLimit = 5
const cleanRestartCountInterval = 30 * 1000
const restart = () => {
  setTimeout(
    () => {
      restartCount++
      if (restartCount >= restartLimit) {
        console.error('Restart limit reached')
        clean()
        return
      }
      main.close()
      main = loadCenter()
    },
    10 + Math.random() * 100
  )
}

setInterval(() => {
  restartCount = 0
}, cleanRestartCountInterval)

const clean = () => {
  process.exit(0)
}
process.on('exit', clean)
process.on('SIGINT', clean)
process.on('SIGTERM', clean)
process.on('beforeExit', clean)
process.on('uncaughtException', (e) => {
  console.error('uncaughtException: ', e)
  restart()
})
process.on('unhandledRejection', (e) => {
  console.error('unhandledRejection: ', e)
  restart()
})
