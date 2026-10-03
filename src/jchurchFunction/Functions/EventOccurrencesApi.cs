using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class EventOccurrencesApi(Repositories repositories, DirectoryService directory, EventService events, ILogger<EventOccurrencesApi> logger)
{
    [Function("EventOccurrences")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/events/{eventId}/occurrences")] HttpRequestData request, string churchId, string eventId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            await directory.Get<ChurchEvent>(churchId, eventId, cancellationToken: ct);
            if (request.Method == "POST") return new ApiResult(200, new { occurrence = await events.Generate(churchId, eventId, ct) });
            if (request.Method == "GET") return new ApiResult(200, await repositories.Occurrences.Search(QueryParsing.ParseQuery(request.Query, churchId) with { EventId = eventId }, ct));
            throw RequestBodies.MethodNotAllowed();
        }, cancellationToken);

    [Function("EventOccurrenceCheckInCounts")]
    public async Task<HttpResponseData> CheckInCounts([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/events/{eventId}/occurrence-check-in-counts")] HttpRequestData request, string churchId, string eventId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "GET") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            await directory.Get<ChurchEvent>(churchId, eventId, cancellationToken: ct);
            return new ApiResult(200, new { items = await repositories.Attendance.ActiveCheckInCounts(churchId, eventId, ct) });
        }, cancellationToken);
}
