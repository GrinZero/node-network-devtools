const { register } = require('node-network-devtools')
const axios = require('axios')
const Koa = require('koa')
const Router = require('koa-router')

register()

const app = new Koa()
const router = new Router()
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

app.use(router.routes())
app.listen(3000)

process.on('message', (msg) => {
  console.log('Message from parent:', msg)
})
