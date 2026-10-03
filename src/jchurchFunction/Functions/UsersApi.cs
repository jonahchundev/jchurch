using JChurch.Domain;
using JChurch.Functions.Api;
using JChurch.Services;
using JChurch.Storage;
using User = JChurch.Domain.User;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class UsersApi(Repositories repositories, UserService users, ILogger<UsersApi> logger)
{
    [Function("UsersList")]
    public async Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/users")] HttpRequestData request, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method == "GET")
            {
                var filters = QueryParsing.ParseUserQuery(request.Query);
                var page = await repositories.Users.Search(filters.Query, ct);
                var items = page.Items.Where(user =>
                    (filters.Role is null || user.Role == filters.Role) &&
                    (filters.Status is null || user.Status == filters.Status) &&
                    (filters.ChurchId is null || user.ChurchIds.Contains(filters.ChurchId))).ToArray();
                return new ApiResult(200, new Page<User>(items, items.Length == page.Items.Count ? page.ContinuationToken : null));
            }
            if (request.Method == "POST")
            {
                var input = await RequestBodies.Body<User>(request, ct);
                var created = await users.Create(input, ct);
                return new ApiResult(201, created, $"{request.Url.AbsolutePath.TrimEnd('/')}/{Uri.EscapeDataString(created.Email)}");
            }
            throw RequestBodies.MethodNotAllowed();
        }, cancellationToken);

    [Function("UsersItem")]
    public async Task<HttpResponseData> Item([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/users/{email}")] HttpRequestData request, string email, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            email = Uri.UnescapeDataString(email);
            if (request.Method == "GET") return new ApiResult(200, await users.Get(email, ct));
            if (request.Method == "PUT")
            {
                var input = await RequestBodies.Body<User>(request, ct);
                return new ApiResult(200, await users.Replace(input, email, RequestBodies.IfMatch(request), ct));
            }
            if (request.Method == "DELETE")
            {
                await users.Archive(email, RequestBodies.IfMatch(request), ct);
                return new ApiResult(204);
            }
            throw RequestBodies.MethodNotAllowed();
        }, cancellationToken);

    [Function("UsersClaim")]
    public async Task<HttpResponseData> Claim([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/users/{email}/claim")] HttpRequestData request, string email, FunctionContext context, CancellationToken cancellationToken)
        => await ApiExecutor.Execute(request, context, logger, async ct =>
        {
            if (request.Method != "POST") throw RequestBodies.MethodNotAllowed();
            return new ApiResult(200, await users.Claim(Uri.UnescapeDataString(email), ct));
        }, cancellationToken);
}
