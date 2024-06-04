const { register } = require("node-network-devtools");
const axios = require("axios");
const Koa = require("koa");
const Router = require("koa-router");

register();

const app = new Koa();
const router = new Router();

router.get("/", async (ctx) => {
  const res = await axios.get("https://jsonplaceholder.typicode.com/posts", {
    headers: {
      Accept: "application/json, text/plain, */*",
    },
  });

  ctx.body = res.data;
});

app.use(router.routes());
app.listen(3000);
