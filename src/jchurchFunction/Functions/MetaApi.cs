using System.Text.Json;
using JChurch.Functions.Api;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class MetaApi(ILogger<MetaApi> logger)
{
    [Function("Health")]
    public async Task<HttpResponseData> Health([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "v1/health")] HttpRequestData request, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, _ => Task.FromResult(new ApiResult(200, new { status = "ok", access = "unauthenticated-development-only" })), cancellationToken);

    [Function("OpenApi")]
    public async Task<HttpResponseData> OpenApi([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "v1/openapi.json")] HttpRequestData request, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            using var stream = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "openapi.json"));
            return new ApiResult(200, await JsonSerializer.DeserializeAsync<JsonElement>(stream, cancellationToken: ct));
        }, cancellationToken);
}
