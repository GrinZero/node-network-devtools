import { RequestDetail } from '../../common'
import { getCurrentCell } from './cell'

export interface RegisterRequestHook {
  (pipe: (req: RequestDetail) => RequestDetail): void
}

export const useRegisterRequest: RegisterRequestHook = (pipe) => {
  const cell = getCurrentCell()

  if (!cell) {
    throw new Error('useRegisterRequest must be used in request handler')
  }

  cell.pipes.push({
    pipe,
    type: 'registerRequest'
  })

  return
}
