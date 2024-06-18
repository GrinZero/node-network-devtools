import { createHanlder } from '../common'

export const getSciptSource = createHanlder(
  'Debugger.getScriptSource',
  ({ id, devtool, request, data }) => {}
)
