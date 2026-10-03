using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class ChurchesApi(Repositories repositories, DirectoryService directory, ILogger<ChurchesApi> logger)
{
    [Function("ChurchesList")]
    public async Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches")] HttpRequestData request, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct => await Resource(request, "", null, ct), cancellationToken);

    [Function("ChurchesItem")]
    public async Task<HttpResponseData> Item([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{id}")] HttpRequestData request, string id, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct => await Resource(request, id, id, ct), cancellationToken);

    [Function("ChurchesPurge")]
    public async Task<HttpResponseData> Purge([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{id}/purge")] HttpRequestData request, string id, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "DELETE") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(id, id, cancellationToken: ct);
            await directory.Purge(id, RequestBodies.IfMatch(request), ct);
            return new ApiResult(204);
        }, cancellationToken);

    private async Task<ApiResult> Resource(HttpRequestData request, string churchId, string? id, CancellationToken cancellationToken)
    {
        if (request.Method == "GET")
            return id is null ? new ApiResult(200, await repositories.For<Church>().Search(QueryParsing.ParseQuery(request.Query, churchId), cancellationToken))
                : new ApiResult(200, await directory.Get<Church>(churchId, id, cancellationToken: cancellationToken));
        if (request.Method == "DELETE" && id is not null)
        {
            await directory.Archive<Church>(churchId, id, RequestBodies.IfMatch(request), cancellationToken);
            return new ApiResult(204);
        }
        if ((request.Method == "POST" && id is null) || (request.Method == "PUT" && id is not null))
        {
            var etag = id is null ? null : RequestBodies.IfMatch(request);
            var input = await RequestBodies.Body<Church>(request, cancellationToken);
            Document saved = await directory.Save(input, churchId, id, etag, cancellationToken);
            return new ApiResult(id is null ? 201 : 200, saved, id is null ? $"{request.Url.AbsolutePath.TrimEnd('/')}/{saved.Id}" : null);
        }
        throw RequestBodies.MethodNotAllowed();
    }
}
