import { describe, it, expect, vi } from 'vitest'
import { Limiter } from './limiter'

describe('Limiter', () => {
  describe('constructor', () => {
    it('应该使用默认并发数 Infinity', () => {
      const limiter = new Limiter()
      expect(limiter.concurrency).toBe(Infinity)
    })

    it('应该接受自定义并发数', () => {
      const limiter = new Limiter(5)
      expect(limiter.concurrency).toBe(5)
    })

    it('应该初始化空的任务队列', () => {
      const limiter = new Limiter()
      expect(limiter.jobs).toEqual([])
    })

    it('应该初始化 pending 为 0', () => {
      const limiter = new Limiter()
      expect(limiter.pending).toBe(0)
    })
  })

  describe('add', () => {
    it('应该立即执行任务当没有并发限制时', () => {
      const limiter = new Limiter()
      const job = vi.fn((done: () => void) => done())

      limiter.add(job)

      expect(job).toHaveBeenCalled()
    })

    it('应该在任务完成后减少 pending 计数', async () => {
      const limiter = new Limiter(1)

      await new Promise<void>((resolve) => {
        limiter.add((done: () => void) => {
          expect(limiter.pending).toBe(1)
          done()
          // 在 done 调用后，pending 应该减少
          expect(limiter.pending).toBe(0)
          resolve()
        })
      })
    })

    it('应该按顺序执行任务当并发数为 1 时', async () => {
      const limiter = new Limiter(1)
      const order: number[] = []

      await new Promise<void>((resolve) => {
        limiter.add((done: () => void) => {
          order.push(1)
          setTimeout(() => {
            done()
          }, 10)
        })

        limiter.add((done: () => void) => {
          order.push(2)
          done()
          resolve()
        })
      })

      expect(order).toEqual([1, 2])
    })

    it('应该并行执行任务当并发数大于 1 时', async () => {
      const limiter = new Limiter(2)
      const startTimes: number[] = []

      await new Promise<void>((resolve) => {
        let completed = 0
        const checkComplete = () => {
          completed++
          if (completed === 2) resolve()
        }

        limiter.add((done: () => void) => {
          startTimes.push(Date.now())
          setTimeout(() => {
            done()
            checkComplete()
          }, 50)
        })

        limiter.add((done: () => void) => {
          startTimes.push(Date.now())
          setTimeout(() => {
            done()
            checkComplete()
          }, 50)
        })
      })

      // 两个任务应该几乎同时开始
      expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(20)
    })

    it('应该在达到并发限制时排队任务', () => {
      const limiter = new Limiter(1)

      // 添加一个不会立即完成的任务
      limiter.add((_done: () => void) => {
        // 不调用 done，保持任务运行
      })

      expect(limiter.pending).toBe(1)

      // 添加第二个任务，应该被排队
      const job2 = vi.fn()
      limiter.add(job2)

      expect(limiter.jobs.length).toBe(1)
      expect(job2).not.toHaveBeenCalled()
    })

    it('应该在任务完成后执行排队的任务', async () => {
      const limiter = new Limiter(1)
      const executionOrder: number[] = []

      await new Promise<void>((resolve) => {
        limiter.add((done: () => void) => {
          executionOrder.push(1)
          setTimeout(done, 10)
        })

        limiter.add((done: () => void) => {
          executionOrder.push(2)
          done()
        })

        limiter.add((done: () => void) => {
          executionOrder.push(3)
          done()
          resolve()
        })
      })

      expect(executionOrder).toEqual([1, 2, 3])
    })
  })

  describe('并发控制', () => {
    it('应该正确限制并发数为 2', async () => {
      const limiter = new Limiter(2)
      let maxConcurrent = 0
      let currentConcurrent = 0

      const createJob = () => (done: () => void) => {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        setTimeout(() => {
          currentConcurrent--
          done()
        }, 20)
      }

      await new Promise<void>((resolve) => {
        let completed = 0
        const totalJobs = 5

        for (let i = 0; i < totalJobs; i++) {
          limiter.add((done: () => void) => {
            createJob()(() => {
              done()
              completed++
              if (completed === totalJobs) resolve()
            })
          })
        }
      })

      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })

    it('应该处理零并发数', () => {
      const limiter = new Limiter(0)
      const job = vi.fn()

      limiter.add(job)

      // 并发数为 0 时，任务应该被排队但不执行
      expect(job).not.toHaveBeenCalled()
      expect(limiter.jobs.length).toBe(1)
    })
  })
})
