import fs from 'fs'
import path from 'path'
import { DevtoolServer } from '../fork/devtool'

function traverseDir(directoryPath: string) {
  const scriptList = []
  const stack = [directoryPath]

  while (stack.length > 0) {
    const currentPath = stack.pop()!

    const items = fs.readdirSync(currentPath)

    for (const item of items) {
      if (item === 'node_modules') {
        continue
      }

      const fullPath = path.join(currentPath, item)
      const stats = fs.statSync(fullPath)

      if (stats.isDirectory()) {
        stack.push(fullPath)
      } else {
        const resolvedPath = path.resolve(fullPath)
        const url = new URL(`file://${resolvedPath.replace(/\\/g, '/')}`)

        scriptList.push({
          url: url.href,
          scriptLanguage: 'JavaScript',
          embedderName: url.href,
          scriptId: scriptList.length,
          // TODO: SourceMap 实际应该是打包后的代码才需要？ 但是这里显示的是实际的代码
          sourceMapURL: '',
          hasSourceURL: false
        })
      }
    }
  }

  return scriptList
}
export function genScriptParsed(devtool: DevtoolServer) {
  // FIXME: 既需要项目路径，又需要当前tools路径，非正确用法
  const scriptList = traverseDir(path.resolve('../..'))
  scriptList.forEach((script) => {
    devtool.send({
      method: 'Debugger.scriptParsed',
      params: script
    })
  })
}
