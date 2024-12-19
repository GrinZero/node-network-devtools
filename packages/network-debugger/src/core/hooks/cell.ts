import { type RequestDetail } from '../../common'
import { RequestType } from '../fork'

export interface Pipe<T = RequestDetail> {
  (req: T): T
}

export interface Cell {
  request: RequestDetail
  pipes: Array<{
    pipe: Pipe<RequestDetail>
    type: RequestType
  }>
  /**
   * @default false
   */
  isAborted: boolean
}

let currentCell: Cell | null = null

export function getCurrentCell() {
  return currentCell
}

export function setCurrentCell(cell: Cell | null) {
  currentCell = cell
}
