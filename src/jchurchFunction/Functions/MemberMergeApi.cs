using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class MemberMergeApi(DirectoryService directory, MemberMergeService merges, ILogger<MemberMergeApi> logger)
{
    [Function("MemberMerge")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/members/{id}/merge")] HttpRequestData request, string churchId, string id, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            if (request.Method != "POST") throw RequestBodies.MethodNotAllowed();
            var input = await RequestBodies.MergeBody(request, ct);
            var dryRun = request.Query["dryRun"] is "true";
            if (dryRun)
                return new ApiResult(200, await merges.Preview(churchId, id, input.LoserId, ct));
            if (string.IsNullOrWhiteSpace(input.LoserEtag)) throw new ApiException(428, "etag_required", "loserEtag is required to merge.");
            var result = await merges.Merge(churchId, id, input.LoserId, input.LoserEtag, input.KeeperUpdate, input.KeeperEtag, ct);
            return new ApiResult(200, result);
        }, cancellationToken);
}
