using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class OccurrencesApi(Repositories repositories, DirectoryService directory, EventService events, ILogger<OccurrencesApi> logger)
{
    private sealed record OverrideRequest(DateTimeOffset StartsAt, DateTimeOffset EndsAt, bool Cancelled, bool Archived, string[]? GroupIds);

    [Function("OccurrencesList")]
    public async Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/occurrences")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            if (request.Method == "GET")
                return new ApiResult(200, await repositories.For<Occurrence>().Search(QueryParsing.ParseQuery(request.Query, churchId), ct));
            throw RequestBodies.MethodNotAllowed();
        }, cancellationToken);

    [Function("OccurrencesItem")]
    public async Task<HttpResponseData> Item([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/occurrences/{id}")] HttpRequestData request, string churchId, string id, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            if (request.Method == "GET")
                return new ApiResult(200, await directory.Get<Occurrence>(churchId, id, cancellationToken: ct));
            if (request.Method != "PUT") throw RequestBodies.MethodNotAllowed();
            var etag = RequestBodies.IfMatch(request);
            var input = await RequestBodies.Body<OverrideRequest>(request, ct);
            return new ApiResult(200, await events.Override(churchId, id, input.StartsAt, input.EndsAt, input.Cancelled, input.Archived, etag, ct, input.GroupIds));
        }, cancellationToken);
}
