const { register } = require("node-network-devtools");
const axios = require("axios");
const Koa = require("koa");
const Router = require("koa-router");

register();

const app = new Koa();
const router = new Router();
router.get("/", async (ctx) => {
  const res = await axios.get("https://jsonplaceholder.typicode.com/posts");
  ctx.body = res.data;
});
throw new Error("error");

router.get("/img", async (ctx) => {
  const res = await axios.get("https://picsum.photos/30/30");
  ctx.body = res.data;
});

router.get('/baidu', async (ctx) => {
  const res = await axios.get('http://www.baidu.com');
  ctx.body = res.data;
})

app.use(router.routes());
app.listen(3000);
