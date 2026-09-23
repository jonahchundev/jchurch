using System.Collections.Specialized;
using System.Globalization;
using System.Net;
using System.Text.Json;
using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class ChurchApi(Repositories repositories, DirectoryService directory, EventService events, CheckInService checkIns, ILogger<ChurchApi> logger)
{
    private sealed record Result(int Status, object? Body = null, string? Location = null);
    private sealed record CheckInRequest(string MemberId);
    private sealed record ScanRequest(string ScanCode);
    private static readonly System.Threading.RateLimiting.TokenBucketRateLimiter ScanLimiter = new(new()
    {
        TokenLimit = 120, TokensPerPeriod = 120, ReplenishmentPeriod = TimeSpan.FromMinutes(1),
        AutoReplenishment = true, QueueLimit = 0
    });
    private sealed record OverrideRequest(DateTimeOffset StartsAt, DateTimeOffset EndsAt, bool Cancelled, bool Archived, string[]? GroupIds);

    [Function("ChurchApi")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "put", "delete", Route = "v1/{*path}")] HttpRequestData request,
        string? path, FunctionContext context, CancellationToken cancellationToken)
    {
        try
        {
            var result = await Dispatch(request, (path ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries), cancellationToken);
            var response = request.CreateResponse((HttpStatusCode)result.Status);
            response.Headers.Add("Cache-Control", "no-store");
            if (result.Body is Document document) response.Headers.Add("ETag", document.ETag);
            if (result.Location is not null) response.Headers.Add("Location", result.Location);
            if (result.Body is not null)
            {
                response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                await JsonSerializer.SerializeAsync(response.Body, result.Body, result.Body.GetType(), Json.Options, cancellationToken);
            }
            return response;
        }
        catch (ApiException error) { return await Problem(request, error.Status, error.Code, error.Message, context.InvocationId, cancellationToken); }
        catch (JsonException) { return await Problem(request, 400, "invalid_json", "Request body contains invalid JSON or unsupported fields.", context.InvocationId, cancellationToken); }
        catch (CosmosException error)
        {
            var status = error.StatusCode == HttpStatusCode.TooManyRequests ? 429 : 503;
            var response = await Problem(request, status, "storage_unavailable", "Storage could not confirm the operation. Retry the same check-in to recover its receipt.", context.InvocationId, cancellationToken);
            response.Headers.Add("Retry-After", Math.Max(1, (int)Math.Ceiling(error.RetryAfter?.TotalSeconds ?? 1)).ToString(CultureInfo.InvariantCulture));
            logger.LogWarning("Storage failure with status {Status}; invocation {InvocationId}", (int)error.StatusCode, context.InvocationId);
            return response;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            logger.LogError("Unhandled {ErrorType}; invocation {InvocationId}", error.GetType().Name, context.InvocationId);
            return await Problem(request, 503, "unavailable", "The operation could not be confirmed. Retry check-in with the same IDs.", context.InvocationId, cancellationToken);
        }
    }

    private async Task<Result> Dispatch(HttpRequestData request, string[] route, CancellationToken cancellationToken)
    {
        if (route is ["health"] && request.Method == "GET") return new(200, new { status = "ok", access = "unauthenticated-development-only" });
        if (route is ["openapi.json"] && request.Method == "GET")
        {
            using var stream = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "openapi.json"));
            return new(200, await JsonSerializer.DeserializeAsync<JsonElement>(stream, cancellationToken: cancellationToken));
        }
        if (route.Length == 0 || route[0] != "churches") throw new ApiException(404, "not_found", "Route not found.");
        if (route.Length <= 2) return await Resource<Church>(request, route.Length == 2 ? route[1] : "", route.Length == 2 ? route[1] : null, cancellationToken);
        var churchId = route[1];
        await directory.Get<Church>(churchId, churchId, cancellationToken: cancellationToken);
        if (route.Length <= 4)
        {
            var id = route.Length == 4 ? route[3] : null;
            return route[2] switch
            {
                "groups" => await Resource<Group>(request, churchId, id, cancellationToken),
                "members" => await Resource<Member>(request, churchId, id, cancellationToken),
                "custom-fields" => await Resource<CustomField>(request, churchId, id, cancellationToken),
                "events" => await Resource<ChurchEvent>(request, churchId, id, cancellationToken),
                "occurrences" => await Resource<Occurrence>(request, churchId, id, cancellationToken),
                "attendance" when id is null && request.Method == "GET" => new(200, await repositories.Attendance.Search(ParseQuery(request.Query, churchId, true), cancellationToken)),
                _ => throw new ApiException(404, "not_found", "Route not found.")
            };
        }
        if (route.Length == 5 && route[2] == "events" && route[4] == "occurrences")
        {
            await directory.Get<ChurchEvent>(churchId, route[3], cancellationToken: cancellationToken);
            if (request.Method == "POST") return new(200, new { occurrence = await events.Generate(churchId, route[3], cancellationToken) });
            if (request.Method == "GET") return new(200, await repositories.Occurrences.Search(ParseQuery(request.Query, churchId) with { EventId = route[3] }, cancellationToken));
            throw MethodNotAllowed();
        }
        if (route is ["churches", _, "events", var eventId, "occurrence-check-in-counts"] && request.Method == "GET")
        {
            await directory.Get<ChurchEvent>(churchId, eventId, cancellationToken: cancellationToken);
            return new(200, new { items = await repositories.Attendance.ActiveCheckInCounts(churchId, eventId, cancellationToken) });
        }
        if (route[2] == "occurrences" && route[4] == "scan-check-ins" &&
            (route.Length == 5 || route is [_, _, _, _, _, "status"]))
        {
            if (request.Method != "POST") throw MethodNotAllowed();
            using var lease = ScanLimiter.AttemptAcquire();
            if (!lease.IsAcquired) throw new ApiException(429, "scan_rate_limit", "Too many scans. Pause before retrying.");
            var input = await Body<ScanRequest>(request, cancellationToken);
            var member = await checkIns.ResolveScan(churchId, input.ScanCode, cancellationToken);
            var display = new { id = member.Id, firstName = member.FirstName, lastName = member.LastName };
            if (route.Length == 6)
            {
                var receipt = await checkIns.Status(churchId, route[3], member.Id, cancellationToken);
                return new(200, new { member = display, checkedIn = receipt is not null, receipt });
            }
            var result = await checkIns.CheckIn(churchId, route[3], member.Id, cancellationToken);
            return new(result.Created ? 201 : 200, new { member = display, receipt = result.Item, already = !result.Created });
        }
        if (route[2] == "occurrences" && route[4] == "check-ins")
        {
            if (route.Length == 5 && request.Method == "POST")
            {
                var input = await Body<CheckInRequest>(request, cancellationToken);
                var result = await checkIns.CheckIn(churchId, route[3], input.MemberId, cancellationToken);
                return new(result.Created ? 201 : 200, result.Item, $"/api/v1/churches/{churchId}/occurrences/{route[3]}/check-ins/{input.MemberId}");
            }
            if (route.Length == 6 && request.Method == "GET")
            {
                var receipt = await checkIns.Status(churchId, route[3], route[5], cancellationToken);
                return new(200, new { checkedIn = receipt is not null, receipt });
            }
            if (route.Length == 6 && request.Method == "DELETE")
            {
                var result = await checkIns.Undo(churchId, route[3], route[5], cancellationToken);
                return new(200, new { receipt = result.Item, undone = result.Created });
            }
        }
        throw new ApiException(404, "not_found", "Route not found.");
    }

    private async Task<Result> Resource<T>(HttpRequestData request, string churchId, string? id, CancellationToken cancellationToken) where T : Document
    {
        if (request.Method == "GET" && id is null && typeof(T) == typeof(Member))
        {
            var page = await repositories.Members.Search(ParseQuery(request.Query, churchId), cancellationToken);
            return new(200, new Page<Member>(page.Items.Select(member => member with { ScanCode = null, ScanCodeFormat = null }).ToArray(), page.ContinuationToken));
        }
        if (request.Method == "GET")
            return id is null ? new(200, await repositories.For<T>().Search(ParseQuery(request.Query, churchId), cancellationToken))
                : new(200, await directory.Get<T>(churchId, id, cancellationToken: cancellationToken));
        if (request.Method == "DELETE" && id is not null && typeof(T) != typeof(Occurrence))
        {
            await directory.Archive<T>(churchId, id, IfMatch(request), cancellationToken);
            return new(204);
        }
        if (typeof(T) == typeof(Occurrence))
        {
            if (request.Method != "PUT" || id is null) throw MethodNotAllowed();
            var etag = IfMatch(request);
            var input = await Body<OverrideRequest>(request, cancellationToken);
            return new(200, await events.Override(churchId, id, input.StartsAt, input.EndsAt, input.Cancelled, input.Archived, etag, cancellationToken, input.GroupIds));
        }
        if ((request.Method == "POST" && id is null) || (request.Method == "PUT" && id is not null))
        {
            var etag = id is null ? null : IfMatch(request);
            var input = await Body<T>(request, cancellationToken);
            Document saved = input is ChurchEvent definition
                ? await events.Save(definition, churchId, id, etag, cancellationToken)
                : await directory.Save(input, churchId, id, etag, cancellationToken);
            return new(id is null ? 201 : 200, saved, id is null ? $"{request.Url.AbsolutePath.TrimEnd('/')}/{saved.Id}" : null);
        }
        throw MethodNotAllowed();
    }

    private static ApiException MethodNotAllowed() => new(405, "method_not_allowed", "Method not supported for this resource.");

    private static string IfMatch(HttpRequestData request)
    {
        if (!request.Headers.TryGetValues("If-Match", out var values) || values.SingleOrDefault() is not { Length: > 0 } etag || etag == "*")
            throw new ApiException(428, "etag_required", "Supply the exact resource ETag in If-Match.");
        return etag;
    }

    private static async Task<T> Body<T>(HttpRequestData request, CancellationToken cancellationToken)
    {
        if (!request.Headers.TryGetValues("Content-Type", out var types) || !types.Any(type => type.Split(';')[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase)))
            throw new ApiException(415, "unsupported_media_type", "Use application/json.");
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int count;
        while ((count = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + count > 65536) throw new ApiException(413, "body_too_large", "Maximum request body is 64 KiB.");
            await buffer.WriteAsync(chunk.AsMemory(0, count), cancellationToken);
        }
        using var document = JsonDocument.Parse(buffer.ToArray());
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (!seen.Add(property.Name)) throw new JsonException();
            if (typeof(Document).IsAssignableFrom(typeof(T)) && new[] { "id", "churchId", "kind", "_etag", "active", "searchText" }.Contains(property.Name, StringComparer.OrdinalIgnoreCase))
                throw new ApiException(400, "read_only_field", "Request includes a server-managed field.");
        }
        var input = document.RootElement.Deserialize<T>(Json.Options) ?? throw new JsonException();
        if (input is Member member)
            return (T)(object)(member with { ScanCodeSpecified = seen.Contains("scanCode"), ScanCodeFormatSpecified = seen.Contains("scanCodeFormat") });
        return input;
    }

    private Query ParseQuery(NameValueCollection values, string churchId, bool attendance = false)
    {
        var allowed = new[] { "search", "eventId", "occurrenceId", "memberId", "groupId", "groupIds", "parentGroupId", "includeSubgroups", "includeArchived", "from", "to", "pageSize", "continuationToken" };
        foreach (var key in values.AllKeys)
            if (key is null || !allowed.Contains(key) || (key != "groupIds" && values.GetValues(key)?.Length != 1)) throw new ApiException(400, "invalid_query", "Unknown or repeated query parameter.");
        bool Flag(string name) => values[name] is not { } value ? false : bool.TryParse(value, out var parsed) ? parsed : throw new ApiException(400, "invalid_query", $"{name} must be true or false.");
        DateTimeOffset? Date(string name) => values[name] is not { } value ? null : DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ? parsed.ToUniversalTime() : throw new ApiException(400, "invalid_query", $"Invalid {name} timestamp.");
        var query = new Query
        {
            ChurchId = churchId, Search = values["search"], EventId = values["eventId"], OccurrenceId = values["occurrenceId"], MemberId = values["memberId"], GroupId = values["groupId"], GroupIds = (values.GetValues("groupIds") ?? []).SelectMany(value => value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).Distinct(StringComparer.Ordinal).ToArray(), ParentGroupId = values["parentGroupId"],
            IncludeSubgroups = Flag("includeSubgroups"), ActiveOnly = !Flag("includeArchived"), From = Date("from"), To = Date("to"), ContinuationToken = values["continuationToken"],
            PageSize = values["pageSize"] is not { } size ? 50 : int.TryParse(size, out var parsed) ? parsed : throw new ApiException(400, "invalid_query", "Invalid pageSize.")
        };
        if (attendance && query.From is not null && query.To is not null)
            DirectoryService.Require(query.To - query.From <= TimeSpan.FromDays(93), "Attendance report ranges must not exceed 93 days.");
        query.Validate();
        return query;
    }

    private static async Task<HttpResponseData> Problem(HttpRequestData request, int status, string code, string detail, string traceId, CancellationToken cancellationToken)
    {
        var response = request.CreateResponse((HttpStatusCode)status);
        response.Headers.Add("Content-Type", "application/problem+json");
        response.Headers.Add("Cache-Control", "no-store");
        if (code == "scan_rate_limit") response.Headers.Add("Retry-After", "60");
        await JsonSerializer.SerializeAsync(response.Body, new { type = $"urn:jchurch:error:{code}", title = code, status, detail, traceId }, Json.Options, cancellationToken);
        return response;
    }
}