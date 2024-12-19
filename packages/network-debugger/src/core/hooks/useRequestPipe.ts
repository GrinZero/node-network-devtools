import { RequestDetail } from '../../common'
import { RequestType } from '../fork'
import { getCurrentCell } from './cell'

export interface RequestPipeHook {
  (type: RequestType, pipe: (req: RequestDetail) => RequestDetail): void
}

export const useRequestPipe: RequestPipeHook = (type, pipe) => {
  const cell = getCurrentCell()

  if (!cell) {
    throw new Error('useRequestPipe must be used in request handler')
  }

  cell.pipes.push({
    pipe,
    type
  })

  return
}
