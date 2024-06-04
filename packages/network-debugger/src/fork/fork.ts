import { RequestCenter } from "./request-center";
import { LOCK_FILE } from "../common";
import fs from "fs";

const DEFAULT_PORT = 5271;
new RequestCenter({ port: DEFAULT_PORT });

process.on("exit", () => {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
});

