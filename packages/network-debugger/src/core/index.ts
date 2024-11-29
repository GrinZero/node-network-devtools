import http from 'http'
import https from 'https'
import { requestProxyFactory } from './request'
import { MainProcess } from './fork'
import { proxyFetch } from './fetch'
import { PORT, SERVER_PORT } from '../common'

import { RegisterOptions } from '../common'
import { generateHash } from '../utils'
import { undiciFetchProxy, undiciRequestProxy } from './undici'

export function register(props?: RegisterOptions) {
  const {
    port = PORT,
    serverPort = SERVER_PORT,
    autoOpenDevtool = true,
    intercept = {}
  } = props || {}

  const {
    fetch: isInterceptFetch = true,
    normal: isInterceptNormal = true,
    undici: isInterceptUndici = false
  } = intercept

  const interceptUndiciFetch = isInterceptUndici && isInterceptUndici.fetch
  const interceptUndiciRequest = isInterceptUndici && isInterceptUndici.request

  const key = generateHash(JSON.stringify({ port, serverPort, autoOpenDevtool }))
  const mainProcess = new MainProcess({
    port,
    serverPort,
    autoOpenDevtool,
    key
  })

  // global fetch
  const unsetFetchProxy = isInterceptFetch ? proxyFetch(mainProcess) : void 0

  // http/https
  const originAgentRequests = new WeakMap()
  const agents = [http, https]
  if (isInterceptNormal) {
    agents.forEach((agent) => {
      originAgentRequests.set(agent, agent.request)
      const actualRequestHandlerFn = agent.request
      agent.request = requestProxyFactory(actualRequestHandlerFn, agent === https, mainProcess)
    })
  }

  // undici
  // undici fetch
  const unsetUndiciFetch = interceptUndiciFetch ? undiciFetchProxy(mainProcess) : void 0
  const unsetUndiciRequest = interceptUndiciRequest ? undiciRequestProxy(mainProcess) : void 0

  return () => {
    unsetFetchProxy && unsetFetchProxy()
    if (isInterceptNormal) {
      agents.forEach((agent) => {
        agent.request = originAgentRequests.get(agent)
        originAgentRequests.delete(agent)
      })
    }

    unsetUndiciFetch && unsetUndiciFetch()

    mainProcess.dispose()
  }
}

export * from './hooks'
