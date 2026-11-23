/// <reference types="vite/client" />

declare module "virtual:asset-manifest" {
  export interface AssetManifest {
    rooms: string[];
    portraits: string[];
  }
  const manifest: AssetManifest;
  export default manifest;
}
