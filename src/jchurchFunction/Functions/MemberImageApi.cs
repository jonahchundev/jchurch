using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class MemberImageApi(DirectoryService directory, MemberImageService memberImages, ILogger<MemberImageApi> logger)
{
    [Function("MemberImage")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/churches/{churchId}/members/{memberId}/image")] HttpRequestData request, string churchId, string memberId, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            await directory.Get<Church>(churchId, churchId, cancellationToken: ct);
            if (request.Method == "PUT")
            {
                var input = await RequestBodies.ImageBody(request, ct);
                return new ApiResult(200, new { imageVersion = await memberImages.Upload(churchId, memberId, input.ContentType, input.Data, ct) });
            }
            if (request.Method == "GET")
            {
                var image = await memberImages.GetImage(churchId, memberId, ct);
                if (image is null) throw new ApiException(404, "not_found", "This member has no photo.");
                // URLs carry ?v={imageVersion}, so cached copies never go stale.
                return new ApiResult(200, Bytes: image.Content, ContentType: image.ContentType, CacheControl: "private, max-age=31536000, immutable");
            }
            if (request.Method == "DELETE")
            {
                await memberImages.Delete(churchId, memberId, ct);
                return new ApiResult(204);
            }
            throw RequestBodies.MethodNotAllowed();
        }, cancellationToken);
}
