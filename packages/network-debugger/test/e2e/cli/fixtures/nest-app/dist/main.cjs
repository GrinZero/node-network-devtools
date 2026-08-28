'use strict'

Object.defineProperty(exports, '__esModule', { value: true })

const { AppModule } = require('./app.module.cjs')
const { NestFactory } = require('./nest-factory.cjs')
const { fail, reportReady } = require('../../probe-core.cjs')

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const address = await app.listen(0, '127.0.0.1')
  await reportReady('nest-compiled', {
    framework: 'nest-style',
    module: AppModule.name,
    listenHost: address.address,
    listenPort: address.port
  })
}

void bootstrap().catch(fail)
