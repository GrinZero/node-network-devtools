<div align="center">
  <h1 align="center">
    <img src="https://github.com/GrinZero/extreme/assets/70185413/415b35ca-6e28-4486-b480-459bda8f1faa" width="100" />
    <br>Node Network Devtools</h1>

 <h3 align="center">🔮  让node程序支持用chrome devtool的network选项卡调试</h3>
 <h3 align="center">🦎  等同于浏览器的爬虫体验 </h3>
 <h3 align="center">⚙️  Powered by CDP</h3>
  <p align="center">
     <img src="https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white" alt="NodeJs"/>
    <img src="https://img.shields.io/badge/Google%20Chrome-4285F4?style=for-the-badge&logo=GoogleChrome&logoColor=white" alt="Chrome"/>
   <img src="https://img.shields.io/badge/TypeScript-3178C6.svg?style=for-the-badge&logo=TypeScript&logoColor=white" alt="TypeScript" />
 </p>

</div>

---

[English](README.md) | 简体中文

## 📖 介绍

如你所见，添加`--inspect`选项打开的node程序并不支持network标签，因为它不去代理用户请求。
node network devtools正是为了解决这个问题，它一个允许您使用chrome devtools的network选项卡调试nodejs发出的请求，让debugger过程等同于浏览器中的网络爬虫体验。

## 🎮 TODO

- [x] HTTP/HTTPS
  - [x] req/res headers
  - [x] payload
  - [x] json str response body
  - [x] binary response body
  - [x] stack follow
    - [x] show stack
    - [x] click to jump
      - [x] base
      - [ ] Sourcemap
- [ ] WebSocket
  - [ ] messages
  - [ ] payload
  - [ ] ...
- [ ] Compatibility
  - [x] commonjs
  - [x] esmodule
  - [ ] Bun

## 👀 预览

![img](https://github.com/GrinZero/node-network-devtools/assets/70185413/5338d8f2-bb54-46fd-b243-a7a5b4af3031)

## 📦 快速开始

### 1. 安装

```bash
# npm
npm install node-network-devtools -D
# or pnpm
pnpm add node-network-devtools -D
# or yarn
yarn add node-network-devtools -D
```

### 2. Usage

只需将以下代码添加到项目的入口文件中即可。

```typescript
import { register } from 'node-network-devtools'

process.env.NODE_ENV === 'development' && register()
```

## 📚 文档

如果遇到任何问题，可以尝试清理`request-centre.lock`文件

![Visitors](https://api.visitorbadge.io/api/visitors?path=https%3A%2F%2Fgithub.com%2FGrinZero%2Fnode-network-devtools&labelColor=%237fa1f7&countColor=%23697689)
