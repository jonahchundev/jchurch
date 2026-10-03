using System.Text.Json;
using JChurch.Domain;
using JChurch.Services;
using Microsoft.Azure.Functions.Worker.Http;

namespace JChurch.Functions.Api;

internal sealed record MemberImageUpload(string ContentType = "", string Data = "");
internal sealed record MemberImportRequest(MemberImportRow[] Rows);
internal sealed record GroupImportRequest(GroupImportRow[] Rows);

internal static class RequestBodies
{
    internal static ApiException MethodNotAllowed() => new(405, "method_not_allowed", "Method not supported for this resource.");

    internal static string IfMatch(HttpRequestData request)
    {
        if (!request.Headers.TryGetValues("If-Match", out var values) || values.SingleOrDefault() is not { Length: > 0 } etag || etag == "*")
            throw new ApiException(428, "etag_required", "Supply the exact resource ETag in If-Match.");
        return etag;
    }

    internal static async Task<T> Body<T>(HttpRequestData request, CancellationToken cancellationToken)
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
            if (typeof(Document).IsAssignableFrom(typeof(T)) && new[] { "id", "churchId", "kind", "_etag", "active", "searchText", "createdOn", "updatedOn", "imageVersion" }.Contains(property.Name, StringComparer.OrdinalIgnoreCase))
                throw new ApiException(400, "read_only_field", "Request includes a server-managed field.");
        }
        var input = document.RootElement.Deserialize<T>(Json.Options) ?? throw new JsonException();
        if (input is Church church)
            return (T)(object)(church with { NewMemberDaysSpecified = seen.Contains("newMemberDays") });
        if (input is Member member)
            return (T)(object)(member with { ScanCodeSpecified = seen.Contains("scanCode"), ScanCodeFormatSpecified = seen.Contains("scanCodeFormat") });
        return input;
    }

    // Photos arrive as base64 JSON (the app downsizes before upload), so they need a larger cap than the 64 KiB document body.
    internal static async Task<MemberImageUpload> ImageBody(HttpRequestData request, CancellationToken cancellationToken)
    {
        if (!request.Headers.TryGetValues("Content-Type", out var types) || !types.Any(type => type.Split(';')[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase)))
            throw new ApiException(415, "unsupported_media_type", "Use application/json.");
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int count;
        while ((count = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + count > 1_400_000) throw new ApiException(413, "body_too_large", "Maximum image request body is 1.4 MB; photos must decode to at most 1 MB.");
            await buffer.WriteAsync(chunk.AsMemory(0, count), cancellationToken);
        }
        using var document = JsonDocument.Parse(buffer.ToArray());
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in document.RootElement.EnumerateObject())
            if (!seen.Add(property.Name)) throw new JsonException();
        return document.RootElement.Deserialize<MemberImageUpload>(Json.Options) ?? throw new JsonException();
    }

    internal static async Task<MemberImportRequest> ImportBody(HttpRequestData request, CancellationToken cancellationToken)
    {
        var input = await BulkImportBody<MemberImportRequest>(request, cancellationToken);
        if (input.Rows.Length > MemberCsvService.MaxImportRows)
            throw new ApiException(400, "too_many_rows", $"At most {MemberCsvService.MaxImportRows} rows are allowed per import.");
        return input;
    }

    internal static async Task<GroupImportRequest> ImportGroupBody(HttpRequestData request, CancellationToken cancellationToken)
    {
        var input = await BulkImportBody<GroupImportRequest>(request, cancellationToken);
        if (input.Rows.Length > GroupCsvService.MaxImportRows)
            throw new ApiException(400, "too_many_rows", $"At most {GroupCsvService.MaxImportRows} rows are allowed per import.");
        return input;
    }

    private static async Task<T> BulkImportBody<T>(HttpRequestData request, CancellationToken cancellationToken)
    {
        if (!request.Headers.TryGetValues("Content-Type", out var types) || !types.Any(type => type.Split(';')[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase)))
            throw new ApiException(415, "unsupported_media_type", "Use application/json.");
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int count;
        while ((count = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + count > 5 * 1024 * 1024) throw new ApiException(413, "body_too_large", "Maximum import body is 5 MiB.");
            await buffer.WriteAsync(chunk.AsMemory(0, count), cancellationToken);
        }
        return JsonSerializer.Deserialize<T>(buffer.ToArray(), Json.Options) ?? throw new JsonException();
    }
}
