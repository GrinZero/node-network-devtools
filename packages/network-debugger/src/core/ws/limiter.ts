const kDone = Symbol('kDone')
const kRun = Symbol('kRun')

/**
 * A very simple job queue with adjustable concurrency. Adapted from
 * https://github.com/STRML/async-limiter
 */
class Limiter {
  concurrency: number
  jobs: Function[]
  pending: number;
  [kDone]: () => void

  /**
   * Creates a new `Limiter`.
   *
   * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
   *     to run concurrently
   */
  constructor(concurrency: number = Infinity) {
    this[kDone] = () => {
      this.pending--
      this[kRun]()
    }
    this.concurrency = concurrency
    this.jobs = []
    this.pending = 0
  }

  /**
   * Adds a job to the queue.
   *
   * @param {Function} job The job to run
   * @public
   */
  add(job: Function) {
    this.jobs.push(job)
    this[kRun]()
  }

  /**
   * Removes a job from the queue and runs it if possible.
   *
   * @private
   */
  [kRun]() {
    if (this.pending === this.concurrency) return

    if (this.jobs.length) {
      const job = this.jobs.shift()!

      this.pending++
      job(this[kDone])
    }
  }
}

export { Limiter }
