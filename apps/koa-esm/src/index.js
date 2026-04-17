// koa-esm
import { register } from 'node-network-devtools'
import axios from 'axios'
import Koa from 'koa'
import Router from 'koa-router'
import got from 'got'
register()

const app = new Koa()
const router = new Router()

router.get('/got', async (ctx) => {
  const res = await got('https://jsonplaceholder.typicode.com/posts')
  ctx.body = res.body
})

router.get('/juejin', async (ctx) => {
  const res = await got({
    method: 'post',
    url: 'https://api.juejin.cn/content_api/v1/article/query_list',
    json: {
      user_id: '1645288319627576',
      sort_type: 2
    }
  })
  ctx.body = res
})

router.get('/', async (ctx) => {
  const res = await axios.get('https://jsonplaceholder.typicode.com/posts')
  ctx.body = res.data
})

router.get('/post', async (ctx) => {
  const res = await axios.post('https://jsonplaceholder.typicode.com/posts', {
    title: 'foo',
    body: 'bar',
    userId: 1
  })
  ctx.body = res.data
})

router.get('/put', async (ctx) => {
  const res = await axios.put('https://jsonplaceholder.typicode.com/posts/1', {
    title: 'foo',
    body: 'bar',
    userId: 101
  })
  ctx.body = res.data
})

router.get('/patch', async (ctx) => {
  const res = await axios.patch('https://jsonplaceholder.typicode.com/posts/1', {
    title: 'xxx'
  })
  ctx.body = res.data
})

router.get('/delete', async (ctx) => {
  const res = await axios.delete('https://jsonplaceholder.typicode.com/posts/1')
  ctx.body = res.data
})

router.get('/img', async (ctx) => {
  const res = await axios.get('https://picsum.photos/30/30')
  ctx.body = res.data
})

router.get('/baidu', async (ctx) => {
  const res = await axios.get('http://www.baidu.com')
  ctx.body = res.data
})

router.get('/fetch', async (ctx) => {
  const res = await fetch('https://jsonplaceholder.typicode.com/posts')
  const data = await res.json()
  ctx.body = data
})

// SSE test endpoint - server side
router.get('/sse-server', async (ctx) => {
  ctx.set('Content-Type', 'text/event-stream')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')

  ctx.status = 200
  ctx.respond = false

  const res = ctx.res
  let count = 0
  const interval = setInterval(() => {
    count++
    res.write(`event: message\nid: ${count}\ndata: {"count": ${count}, "time": "${new Date().toISOString()}"}\n\n`)
    if (count >= 5) {
      clearInterval(interval)
      res.end()
    }
  }, 500)
})

// SSE test endpoint - fetch SSE from external source
router.get('/sse-fetch', async (ctx) => {
  // Fetch SSE from our own server
  const response = await fetch('http://localhost:3001/sse-server')
  
  // Consume the stream to capture events
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let result = ''
  
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  
  ctx.body = { message: 'SSE stream consumed', data: result }
})

app.use(router.routes())
app.listen(3001)

console.log('koa-esm is running on port 3001')

process.on('message', (msg) => {
  console.log('Message from parent:', msg)
})
