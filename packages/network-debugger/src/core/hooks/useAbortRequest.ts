import { getCurrentCell } from './cell'

export const useAbortRequest = () => {
  const cell = getCurrentCell()

  if (!cell) {
    throw new Error('useRegisterRequest must be used in request handler')
  }

  cell.isAborted = true

  return
}
