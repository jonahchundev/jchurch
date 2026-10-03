using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class CheckInsApi(DirectoryService directory, CheckInService checkIns, ILogger<CheckInsApi> logger)
{
    private sealed record CheckInRequest(string MemberId);
    private sealed record ScanRequest(string ScanCode);
    private static readonly System.Threading.RateLimiting.TokenBucketRateLimiter ScanLimiter = new(new()
    {
        TokenLimit = 120, TokensPerPeriod = 120, ReplenishmentPeriod = TimeSpan.FromMinutes(1),
        AutoReplenishment = true, QueueLimit = 0
    });

    [Function("CheckInsCreate")]
    public async Task<HttpResponseData> Create([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/occurrences/{occurrenceId}/check-ins")] HttpRequestData request, string churchId, string occurrenceId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "POST") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            var input = await RequestBodies.Body<CheckInRequest>(request, ct);
            var result = await checkIns.CheckIn(churchId, occurrenceId, input.MemberId, ct);
            return new ApiResult(result.Created ? 201 : 200, result.Item, $"/api/v1/churches/{churchId}/occurrences/{occurrenceId}/check-ins/{input.MemberId}");
        }, cancellationToken);

    [Function("CheckInsItem")]
    public async Task<HttpResponseData> Item([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/occurrences/{occurrenceId}/check-ins/{memberId}")] HttpRequestData request, string churchId, string occurrenceId, string memberId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            if (request.Method == "GET")
            {
                var receipt = await checkIns.Status(churchId, occurrenceId, memberId, ct);
                return new ApiResult(200, new { checkedIn = receipt is not null, receipt });
            }
            if (request.Method == "DELETE")
            {
                var result = await checkIns.Undo(churchId, occurrenceId, memberId, ct);
                return new ApiResult(200, new { receipt = result.Item, undone = result.Created });
            }
            throw RequestBodies.MethodNotAllowed();
        }, cancellationToken);

    [Function("ScanCheckIns")]
    public async Task<HttpResponseData> Scan([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/occurrences/{occurrenceId}/scan-check-ins")] HttpRequestData request, string churchId, string occurrenceId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "POST") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            var (member, display) = await ResolveScan(request, churchId, ct);
            var result = await checkIns.CheckIn(churchId, occurrenceId, member.Id, ct);
            return new ApiResult(result.Created ? 201 : 200, new { member = display, receipt = result.Item, already = !result.Created });
        }, cancellationToken);

    [Function("ScanCheckInsStatus")]
    public async Task<HttpResponseData> ScanStatus([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/occurrences/{occurrenceId}/scan-check-ins/status")] HttpRequestData request, string churchId, string occurrenceId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "POST") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            var (member, display) = await ResolveScan(request, churchId, ct);
            var receipt = await checkIns.Status(churchId, occurrenceId, member.Id, ct);
            return new ApiResult(200, new { member = display, checkedIn = receipt is not null, receipt });
        }, cancellationToken);

    private async Task<(Member member, object display)> ResolveScan(HttpRequestData request, string churchId, CancellationToken cancellationToken)
    {
        using var lease = ScanLimiter.AttemptAcquire();
        if (!lease.IsAcquired) throw new ApiException(429, "scan_rate_limit", "Too many scans. Pause before retrying.");
        var input = await RequestBodies.Body<ScanRequest>(request, cancellationToken);
        var member = await checkIns.ResolveScan(churchId, input.ScanCode, cancellationToken);
        return (member, new { id = member.Id, firstName = member.FirstName, lastName = member.LastName, imageVersion = member.ImageVersion });
    }
}
