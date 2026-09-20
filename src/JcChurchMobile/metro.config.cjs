const { getDefaultConfig } = require("expo/metro-config");
const http = require("node:http");

const config = getDefaultConfig(__dirname);
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (request, response, next) => {
    if (!request.url?.startsWith("/api/v1/"))
      return middleware(request, response, next);
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: 7071,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: "127.0.0.1:7071" },
      },
      (result) => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(503, { "Content-Type": "application/problem+json" });
      response.end(
        JSON.stringify({
          detail:
            "Local API is unavailable. Start the existing development API on port 7071.",
        }),
      );
    });
    request.pipe(upstream);
  },
};
module.exports = config;
