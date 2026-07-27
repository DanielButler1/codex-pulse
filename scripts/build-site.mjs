import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(npm, args, { stdio: "inherit", shell: false });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`web build exited with ${code}`)));
});

await run(["--prefix", "web", "ci", "--ignore-scripts"]);
await run(["--prefix", "web", "run", "build"]);
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("web/dist", "dist", { recursive: true });
