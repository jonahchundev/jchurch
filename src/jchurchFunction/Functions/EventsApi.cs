using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class EventsApi(Repositories repositories, DirectoryService directory, EventService events, ILogger<EventsApi> logger)
{
    [Function("EventsList")]
    public async Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/events")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct => await Resource(request, churchId, null, ct), cancellationToken);

    [Function("EventsItem")]
    public async Task<HttpResponseData> Item([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/events/{id}")] HttpRequestData request, string churchId, string id, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct => await Resource(request, churchId, id, ct), cancellationToken);

    private async Task<ApiResult> Resource(HttpRequestData request, string churchId, string? id, CancellationToken cancellationToken)
    {
        await directory.Get<Church>(churchId, churchId, cancellationToken: cancellationToken);
        if (request.Method == "GET")
            return id is null ? new ApiResult(200, await repositories.For<ChurchEvent>().Search(QueryParsing.ParseQuery(request.Query, churchId), cancellationToken))
                : new ApiResult(200, await directory.Get<ChurchEvent>(churchId, id, cancellationToken: cancellationToken));
        if (request.Method == "DELETE" && id is not null)
        {
            await directory.Archive<ChurchEvent>(churchId, id, RequestBodies.IfMatch(request), cancellationToken);
            return new ApiResult(204);
        }
        if ((request.Method == "POST" && id is null) || (request.Method == "PUT" && id is not null))
        {
            var etag = id is null ? null : RequestBodies.IfMatch(request);
            var input = await RequestBodies.Body<ChurchEvent>(request, cancellationToken);
            Document saved = await events.Save(input, churchId, id, etag, cancellationToken);
            return new ApiResult(id is null ? 201 : 200, saved, id is null ? $"{request.Url.AbsolutePath.TrimEnd('/')}/{saved.Id}" : null);
        }
        throw RequestBodies.MethodNotAllowed();
    }
}
