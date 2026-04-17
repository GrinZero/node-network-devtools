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

// Test case 1: text/plain + JSON body
router.get('/post-text-plain', async (ctx) => {
  const res = await axios.post(
    'https://jsonplaceholder.typicode.com/posts',
    JSON.stringify({ title: 'foo', body: 'bar', userId: 1 }),
    { headers: { 'Content-Type': 'text/plain' } }
  )
  ctx.body = res.data
})

// Test case 2: application/x-www-form-urlencoded
router.get('/post-form', async (ctx) => {
  const res = await axios.post(
    'https://jsonplaceholder.typicode.com/posts',
    'title=foo&body=bar&userId=1',
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  ctx.body = res.data
})

// Test case 3: pure text body
router.get('/post-pure-text', async (ctx) => {
  const res = await axios.post(
    'https://jsonplaceholder.typicode.com/posts',
    'This is a plain text message',
    { headers: { 'Content-Type': 'text/plain' } }
  )
  ctx.body = res.data
})

// Test case 4: Buffer body
router.get('/post-buffer', async (ctx) => {
  const buffer = Buffer.from(JSON.stringify({ title: 'buffer', body: 'test', userId: 1 }))
  const res = await axios.post('https://jsonplaceholder.typicode.com/posts', buffer, {
    headers: { 'Content-Type': 'application/json' }
  })
  ctx.body = res.data
})

app.use(router.routes())
app.listen(3001)

console.log('koa-esm is running on port 3001')

process.on('message', (msg) => {
  console.log('Message from parent:', msg)
})
