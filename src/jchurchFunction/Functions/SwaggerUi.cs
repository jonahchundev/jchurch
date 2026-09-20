using System.IO.Compression;
using System.Net;
using System.Text;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Swashbuckle.AspNetCore.SwaggerUI;

namespace JChurch.Functions;

public sealed class SwaggerUi
{
    private const string Index = """
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>JChurch API - Swagger UI</title>
          <link rel="icon" type="image/png" href="/api/swagger/favicon-32x32.png">
          <link rel="stylesheet" href="/api/swagger/swagger-ui.css">
        </head>
        <body>
          <div id="swagger-ui"></div>
          <script src="/api/swagger/swagger-ui-bundle.js"></script>
          <script src="/api/swagger/swagger-initializer.js"></script>
        </body>
        </html>
        """;

    private const string Initializer = """
        window.ui = SwaggerUIBundle({
          url: '/api/v1/openapi.json',
          dom_id: '#swagger-ui',
          deepLinking: true,
          filter: true,
          displayRequestDuration: true,
          persistAuthorization: false,
          validatorUrl: null,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout'
        });
        """;

    [Function("SwaggerUi")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "swagger/{asset?}")] HttpRequestData request,
        string? asset, CancellationToken cancellationToken)
    {
        var content = OpenAsset(asset);
        var response = request.CreateResponse(content is null ? HttpStatusCode.NotFound : HttpStatusCode.OK);
        response.Headers.Add("Cache-Control", "no-store");
        response.Headers.Add("X-Content-Type-Options", "nosniff");
        response.Headers.Add("Referrer-Policy", "no-referrer");
        response.Headers.Add("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        if (content is not null)
        {
            response.Headers.Add("Content-Type", content.Value.ContentType);
            using var stream = content.Value.Content;
            await stream.CopyToAsync(response.Body, cancellationToken);
        }
        return response;
    }

    public static (Stream Content, string ContentType)? OpenAsset(string? asset)
    {
        if (asset is null or "" or "index.html") return (new MemoryStream(Encoding.UTF8.GetBytes(Index)), "text/html; charset=utf-8");
        if (asset == "swagger-initializer.js") return (new MemoryStream(Encoding.UTF8.GetBytes(Initializer)), "text/javascript; charset=utf-8");
        var contentType = asset switch
        {
            "swagger-ui.css" => "text/css; charset=utf-8",
            "swagger-ui-bundle.js" => "text/javascript; charset=utf-8",
            "favicon-32x32.png" => "image/png",
            _ => null
        };
        if (contentType is null) return null;
        var assembly = typeof(SwaggerUIOptions).Assembly;
        var resource = assembly.GetManifestResourceNames().Single(name => name.EndsWith($".{asset}", StringComparison.Ordinal));
        var stream = assembly.GetManifestResourceStream(resource) ?? throw new InvalidOperationException("Swagger UI asset is missing.");
        var compressed = stream.ReadByte() == 0x1f && stream.ReadByte() == 0x8b;
        stream.Position = 0;
        return (compressed ? new GZipStream(stream, CompressionMode.Decompress) : stream, contentType);
    }
}