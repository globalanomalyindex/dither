import { defineConfig } from "vite";


export default defineConfig({
  appType: "spa",
  base: "/dither/",
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  server: {
    host: "127.0.0.1",
    open: "/dither/",
    port: 5173,
    strictPort: true,
  },
});
