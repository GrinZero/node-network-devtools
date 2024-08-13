import http from 'http'
import https from 'https'
import { requestProxyFactory } from './request'
import { MainProcess } from './fork'
import { proxyFetch } from './fetch'
import { PORT, SERVER_PORT } from '../common'

import { RegisterOptions } from '../common'

export async function register(props?: RegisterOptions) {
  const { port = PORT, serverPort = SERVER_PORT, autoOpenDevtool = true } = props || {}
  const mainProcess = new MainProcess({
    port,
    serverPort,
    autoOpenDevtool
  })

  proxyFetch(mainProcess)

  const agents = [http, https]
  agents.forEach((agent) => {
    const actualRequestHandlerFn = agent.request
    agent.request = requestProxyFactory(actualRequestHandlerFn, agent === https, mainProcess)
  })
}
