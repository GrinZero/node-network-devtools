import { RequestCenter } from "./request-center";
import { LOCK_FILE, SERVER_PORT } from "../common";
import fs from "fs";

let main = new RequestCenter({ port: SERVER_PORT });

const restart = () => {
  main.close();
  main = new RequestCenter({ port: SERVER_PORT, requests: main.requests });
};

const clean = () => {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
  process.exit();
};
process.on("exit", clean);
process.on("SIGINT", clean);
process.on("SIGTERM", clean);
process.on("beforeExit", clean);
process.on("uncaughtException", (e) => {
  console.error("uncaughtException: ", e);
  restart();
});
process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection: ", e);
  restart();
});
