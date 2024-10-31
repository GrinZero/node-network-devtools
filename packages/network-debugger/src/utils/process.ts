import net from 'net'

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const checkMainProcessAlive = (pid: number | string, port: number) => {
  try {
    if (Number(pid) === process.pid) {
      return Promise.resolve(true)
    }
    process.kill(Number(pid), 0)

    // 检查 port 是否被占用
    return new Promise<boolean>((resolve) => {
      const server = net.createServer()

      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // 端口被占用
          resolve(false)
        }
        // fallback 其他错误
        resolve(false)
      })

      server.once('listening', () => {
        // 端口未被占用
        server.close(() => resolve(true))
      })

      server.listen(port)
    })
  } catch {
    return Promise.resolve(false)
  }
}
