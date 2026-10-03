using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class AttendanceApi(Repositories repositories, DirectoryService directory, ILogger<AttendanceApi> logger)
{
    [Function("AttendanceList")]
    public async Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/attendance")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "GET") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            return new ApiResult(200, await repositories.Attendance.Search(QueryParsing.ParseQuery(request.Query, churchId, attendance: true), ct));
        }, cancellationToken);

    [Function("AttendanceSummary")]
    public async Task<HttpResponseData> Summary([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/attendance/summary")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "GET") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            var (query, groupBy) = QueryParsing.ParseSummaryQuery(request.Query, churchId);
            return new ApiResult(200, new { items = await repositories.Attendance.Summarize(query, groupBy, ct) });
        }, cancellationToken);
}
