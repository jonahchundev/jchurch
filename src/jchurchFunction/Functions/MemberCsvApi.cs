using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class MemberCsvApi(DirectoryService directory, MemberCsvService memberCsv, ILogger<MemberCsvApi> logger)
{
    [Function("MemberCsvExport")]
    public async Task<HttpResponseData> Export([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/members/export")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "GET") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            return new ApiResult(200, await memberCsv.ExportCsv(churchId, ct), RawText: true);
        }, cancellationToken);

    [Function("MemberCsvImportTemplate")]
    public async Task<HttpResponseData> ImportTemplate([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/members/import-template")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "GET") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            return new ApiResult(200, await memberCsv.ImportTemplate(churchId, ct), RawText: true);
        }, cancellationToken);

    [Function("MemberCsvImport")]
    public async Task<HttpResponseData> Import([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/members/import")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "POST") throw RequestBodies.MethodNotAllowed();
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            var input = await RequestBodies.ImportBody(request, ct);
            return new ApiResult(200, await memberCsv.Import(churchId, input.Rows, ct));
        }, cancellationToken);
}
