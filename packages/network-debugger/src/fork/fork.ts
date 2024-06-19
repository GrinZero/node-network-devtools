import { RequestCenter } from './request-center'
import { LOCK_FILE, SERVER_PORT } from '../common'
import fs from 'fs'
import { loadPlugin } from './module'

let main = new RequestCenter({ port: SERVER_PORT })
loadPlugin(main)

let restartCount = 0
const restartLimit = 5
const cleanRestartCountInterval = 30 * 1000
const restart = () => {
  restartCount++
  if (restartCount >= restartLimit) {
    console.error('Restart limit reached')
    clean()
    return
  }
  main.close()
  main = new RequestCenter({ port: SERVER_PORT, requests: main.requests })
  loadPlugin(main)
}

setInterval(() => {
  restartCount = 0
}, cleanRestartCountInterval)

const clean = () => {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE)
  }
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
