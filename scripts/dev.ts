import { join } from "node:path"

const raiz = join(import.meta.dir, "..")
const api = Bun.spawn(["bun", "run", "src/server.ts"], {
  cwd: raiz,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
})
const web = Bun.spawn(["bun", "x", "vite"], {
  cwd: raiz,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
})

function detener(): void {
  api.kill()
  web.kill()
}

process.on("SIGINT", () => {
  detener()
  process.exit(0)
})
process.on("SIGTERM", () => {
  detener()
  process.exit(0)
})

const codigo = await Promise.race([api.exited, web.exited])
detener()
process.exit(codigo)
