using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class MembersApi(Repositories repositories, DirectoryService directory, ILogger<MembersApi> logger)
{
    [Function("MembersList")]
    public async Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/members")] HttpRequestData request, string churchId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct => await Resource(request, churchId, null, ct), cancellationToken);

    [Function("MembersItem")]
    public async Task<HttpResponseData> Item([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/members/{id}")] HttpRequestData request, string churchId, string id, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct => await Resource(request, churchId, id, ct), cancellationToken);

    private async Task<ApiResult> Resource(HttpRequestData request, string churchId, string? id, CancellationToken cancellationToken)
    {
        await directory.Get<Church>(churchId, churchId, cancellationToken: cancellationToken);
        if (request.Method == "GET" && id is null)
        {
            var page = await repositories.Members.Search(QueryParsing.ParseQuery(request.Query, churchId, memberSort: true), cancellationToken);
            return new ApiResult(200, new Page<Member>(page.Items.Select(member => member with { ScanCode = null, ScanCodeFormat = null }).ToArray(), page.ContinuationToken));
        }
        if (request.Method == "GET")
            return new ApiResult(200, await directory.Get<Member>(churchId, id!, cancellationToken: cancellationToken));
        if (request.Method == "DELETE" && id is not null)
        {
            await directory.Archive<Member>(churchId, id, RequestBodies.IfMatch(request), cancellationToken);
            return new ApiResult(204);
        }
        if ((request.Method == "POST" && id is null) || (request.Method == "PUT" && id is not null))
        {
            var etag = id is null ? null : RequestBodies.IfMatch(request);
            var input = await RequestBodies.Body<Member>(request, cancellationToken);
            Document saved = await directory.Save(input, churchId, id, etag, cancellationToken);
            return new ApiResult(id is null ? 201 : 200, saved, id is null ? $"{request.Url.AbsolutePath.TrimEnd('/')}/{saved.Id}" : null);
        }
        throw RequestBodies.MethodNotAllowed();
    }
}
