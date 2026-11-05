// sql.js loads its WebAssembly binary at runtime; serve it from public/ next to the app.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
copyFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url), new URL("../public/sql-wasm.wasm", import.meta.url));
