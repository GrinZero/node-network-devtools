import { RequestCenter } from "./request-center";
import { LOCK_FILE, SERVER_PORT } from "../common";
import fs from "fs";

new RequestCenter({ port: SERVER_PORT });

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