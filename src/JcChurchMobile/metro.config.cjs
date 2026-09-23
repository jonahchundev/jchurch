const { getDefaultConfig } = require("expo/metro-config");
const http = require("node:http");
const https = require("node:https");
const {
  getWebProxyTarget,
  proxyRequestPath,
} = require("./src/api/api-url.cjs");

const config = getDefaultConfig(__dirname);
const webApiUrl = getWebProxyTarget(process.env.EXPO_PUBLIC_API_URL_WEB);
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (request, response, next) => {
    if (!request.url?.startsWith("/api/v1/"))
      return middleware(request, response, next);
    const requestClient = webApiUrl.protocol === "https:" ? https : http;
    const upstream = requestClient.request(
      {
        protocol: webApiUrl.protocol,
        hostname: webApiUrl.hostname,
        port: webApiUrl.port || undefined,
        path: proxyRequestPath(request.url, webApiUrl),
        method: request.method,
        headers: { ...request.headers, host: webApiUrl.host },
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
            `Local API is unavailable at ${webApiUrl.toString().replace(/\/$/, "")}.`,
        }),
      );
    });
    request.pipe(upstream);
  },
};
module.exports = config;
