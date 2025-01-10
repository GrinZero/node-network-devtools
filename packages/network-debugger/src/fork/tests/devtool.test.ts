import { DevtoolMessage } from '../devtool'
import { BaseDevtoolServer, IDevtoolServer, DevtoolServerInitOptions } from '../devtool/index'

/**
 * 模拟 Devtool server，作为 core 上下文用于测试
 */
export class DevToolTester extends BaseDevtoolServer implements IDevtoolServer {
  private port: number
  constructor(props: DevtoolServerInitOptions) {
    super()
    const { port, autoOpenDevtool = true } = props

    this.port = port
    autoOpenDevtool && this.open()
  }
  async send(message: DevtoolMessage) {
    return message
  }
  async open() {}
  close() {}
}
