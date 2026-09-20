using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using JChurch.Domain;

namespace JChurch.Storage;

public sealed record Query
{
    public string ChurchId { get; init; } = "";
    public string? Search { get; init; }
    public string? EventId { get; init; }
    public string? OccurrenceId { get; init; }
    public string? MemberId { get; init; }
    public string? GroupId { get; init; }
    public string? ParentGroupId { get; init; }
    public bool IncludeSubgroups { get; init; }
    public bool ActiveOnly { get; init; } = true;
    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }
    public int PageSize { get; init; } = 50;
    public string? ContinuationToken { get; init; }

    public void Validate()
    {
        if (PageSize is < 1 or > 200 || Search?.Length > 100 || ContinuationToken?.Length > 32000 || From > To)
            throw new ApiException(400, "invalid_query", "Invalid page size, search, continuation token, or date range.");
    }

    public string Fingerprint<T>() => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        typeof(T).Name + JsonSerializer.Serialize(this with { ContinuationToken = null }, Json.Options))));

    public bool Matches(Document document)
    {
        if ((document.ChurchId != ChurchId && !(document is Church && ChurchId == "")) || (ActiveOnly && !document.Active)) return false;
        if (Search is not null && !document.SearchText.Contains(Search, StringComparison.OrdinalIgnoreCase)) return false;
        var data = JsonSerializer.SerializeToElement(document, document.GetType(), Json.Options);
        bool Equal(string name, string? value) => value is null || (data.TryGetProperty(name, out var property) && property.GetString() == value);
        if (!Equal("eventId", EventId) || !Equal("occurrenceId", OccurrenceId) || !Equal("memberId", MemberId) || !Equal("parentGroupId", ParentGroupId)) return false;
        if (GroupId is not null)
        {
            var field = IncludeSubgroups && document is Attendance ? "inclusiveGroupIds" : "groupIds";
            if (!data.TryGetProperty(field, out var groups) || !groups.EnumerateArray().Any(group => group.GetString() == GroupId)) return false;
        }
        var date = document switch { Attendance attendance => attendance.CheckedInAt, Occurrence occurrence => occurrence.StartsAt, _ => (DateTimeOffset?)null };
        return (From is null || date >= From) && (To is null || date < To);
    }
}

public sealed record Page<T>(IReadOnlyList<T> Items, string? ContinuationToken);
public sealed record Creation<T>(T Item, bool Created);

public interface IRepository<T> where T : Document
{
    Task<T?> Get(string churchId, string id, string? occurrenceId = null, CancellationToken cancellationToken = default);
    Task<Creation<T>> Create(T document, CancellationToken cancellationToken = default);
    Task<T> Replace(T document, string etag, CancellationToken cancellationToken = default);
    Task<Page<T>> Search(Query query, CancellationToken cancellationToken = default);
    Task<Member?> ResolveScanCode(string churchId, string code, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Scan lookup requires a member repository.");
}

public static class Cursor
{
    private sealed record Value(string Fingerprint, string Position);

    public static string Encode<T>(Query query, string position) => Convert.ToBase64String(
        JsonSerializer.SerializeToUtf8Bytes(new Value(query.Fingerprint<T>(), position), Json.Options));

    public static string? Decode<T>(Query query)
    {
        if (query.ContinuationToken is null) return null;
        try
        {
            var value = JsonSerializer.Deserialize<Value>(Convert.FromBase64String(query.ContinuationToken), Json.Options);
            if (value is null || value.Fingerprint != query.Fingerprint<T>()) throw new FormatException();
            return value.Position;
        }
        catch (Exception error) when (error is FormatException or JsonException)
        {
            throw new ApiException(400, "invalid_cursor", "Continuation token does not match this query.");
        }
    }
}