using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class GroupCsvApi(DirectoryService directory, GroupCsvService groupCsv, ILogger<GroupCsvApi> logger)
{
    [Function("GroupCsvExport")]
    public async Task<HttpResponseData> Export([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/groups/export")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "GET") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            return new ApiResult(200, await groupCsv.ExportCsv(churchId, ct), RawText: true);
        }, cancellationToken);

    [Function("GroupCsvImportTemplate")]
    public async Task<HttpResponseData> ImportTemplate([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/groups/import-template")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "GET") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            return new ApiResult(200, groupCsv.ImportTemplate(), RawText: true);
        }, cancellationToken);

    [Function("GroupCsvImport")]
    public async Task<HttpResponseData> Import([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/groups/import")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "POST") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            var input = await RequestBodies.ImportGroupBody(request, ct);
            return new ApiResult(200, await groupCsv.Import(churchId, input.Rows, ct));
        }, cancellationToken);
}
