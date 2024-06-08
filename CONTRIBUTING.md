# Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement". Don't forget to give the project a star! Thanks again!

Fork the Project Create your Feature Branch (git checkout -b feature/AmazingFeature) Commit your Changes (git commit -m 'Add some AmazingFeature') Push to the Branch (git push origin feature/AmazingFeature) Open a Pull Request

# Development

## How to debug node-network-devtools?

### 1. install

```bash
pnpm i
```

### 2. watch the node-network-devtools

this command will watch the node-network-devtools and rebuild it when the source code changes.

```bash
pnpm dev --filter=node-network-devtools
```

### 3. open a new terminal and run the example

you can use the first command to run the example and it will restart the devtools when the source code changes.

```bash
pnpm dev --filter=koa
```

or you can use the second command to run the example and it will not restart the devtools when the source code changes.

```bash
pnpm start --filter=koa
```
