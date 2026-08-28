'use strict'

const http = require('node:http')

exports.NestFactory = {
  async create(AppModule) {
    const module = new AppModule()
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ framework: 'nest-style', module: module.constructor.name }))
    })

    return {
      async listen(port, host) {
        await new Promise((resolve, reject) => {
          server.once('error', reject)
          server.listen(port, host, resolve)
        })
        return server.address()
      }
    }
  }
}
