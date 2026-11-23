import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const VIRTUAL_MODULE_ID = "virtual:asset-manifest";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_MODULE_ID;

function scanPngIds(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((file) => file.toLowerCase().endsWith(".png"))
    .map((file) => path.basename(file, path.extname(file)));
}

function assetManifestPlugin(): Plugin {
  let rootDir = process.cwd();

  return {
    name: "eomm-asset-manifest",
    configResolved(config) {
      rootDir = config.root;
    },
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
      return undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return undefined;
      const roomsDir = path.join(rootDir, "public", "assets", "rooms");
      const portraitsDir = path.join(rootDir, "public", "assets", "portraits");
      const manifest = {
        rooms: scanPngIds(roomsDir),
        portraits: scanPngIds(portraitsDir),
      };
      return `export default ${JSON.stringify(manifest)};`;
    },
  };
}

export default defineConfig({
  plugins: [assetManifestPlugin()],
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
