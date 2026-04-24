import { contextBridge } from 'electron'

// WS3 populates this with the sidecar's baseUrl + bearer token after
// `SANCTUM_READY` is parsed and `/health` returns 200. Until then the
// renderer sees `ready: false` and keeps the splash screen up.
contextBridge.exposeInMainWorld('sanctum', {
  ready: false,
})
