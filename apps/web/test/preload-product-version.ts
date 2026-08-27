import { readFileSync } from "node:fs";
import { join } from "node:path";

Object.assign(globalThis, {
  __TMTERMINAL_VERSION__: readFileSync(join(import.meta.dir, "../../../VERSION"), "utf8").trim(),
});
