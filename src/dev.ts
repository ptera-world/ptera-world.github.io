const isProduction = Bun.argv.includes("--production");

const dir = isProduction ? "dist" : "public";

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;

    // In dev, serve TS files as bundled JS
    if (!isProduction && path === "/main.js") {
      const result = await Bun.build({
        entrypoints: ["src/main.ts"],
        target: "browser",
      });
      const output = result.outputs[0];
      if (output) {
        return new Response(output.stream(), {
          headers: { "Content-Type": "application/javascript" },
        });
      }
    }

    const file = Bun.file(dir + path);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`listening on http://localhost:${server.port}`);
