import { createPlugin, useContext, useHandler } from '../common'

export const useStore = () => {
  const { devtool } = useContext()
  devtool.send({})
}

export const debuggerPlugin = createPlugin(({ devtool }) => {
  useHandler('Debugger.getSciptSource', ({ id, request }) => {
    console.log('Debugger.getSciptSource', devtool, id, request)
  })
})
