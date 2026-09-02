import index from "./index.html";

const port = Number(process.env.PORT) || 3000;

const server = Bun.serve({
  port,
  routes: {
    "/": index,
    "/demo_at_frame.png": Bun.file("./examples/demo_at_frame.png"),
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`\n  🚀 Three.js ASCII Renderer Browser Demo running at:\n  👉 http://localhost:${server.port}\n`);
