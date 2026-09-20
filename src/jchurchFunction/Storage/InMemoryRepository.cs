using JChurch.Domain;

namespace JChurch.Storage;

public sealed class InMemoryRepository<T> : IRepository<T> where T : Document
{
    private readonly object gate = new();
    private readonly Dictionary<(string Church, string Occurrence, string Id), T> documents = [];
    private readonly Dictionary<(string Church, string Code), string> scanOwners = [];

    private T AssignCode(T document, T? existing = null)
    {
        if (document is not Member member) return document;
        member = ScanCodes.Normalize(member);
        if (member.ScanCode is { } code && scanOwners.TryGetValue((member.ChurchId, code), out var owner) && owner != member.Id)
            throw ScanCodes.Conflict();
        if (existing is Member { ScanCode: { } oldCode }) scanOwners.Remove((member.ChurchId, oldCode));
        if (member.ScanCode is { } newCode) scanOwners[(member.ChurchId, newCode)] = member.Id;
        return (T)(Document)member;
    }

    public Task<Member?> ResolveScanCode(string churchId, string code, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var canonical = ScanCodes.Normalize(code);
        lock (gate)
        {
            if (scanOwners.TryGetValue((churchId, canonical), out var owner) &&
                documents.TryGetValue((churchId, "", owner), out var document) &&
                document is Member member && member.Active && member.ScanCode == canonical)
                return Task.FromResult<Member?>(Json.Clone(member));
            return Task.FromResult<Member?>(null);
        }
    }

    private static (string, string, string) Key(T document) =>
        (document.ChurchId, document is Attendance attendance ? attendance.OccurrenceId : "", document.Id);

    public Task<T?> Get(string churchId, string id, string? occurrenceId = null, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (gate)
        {
            documents.TryGetValue((churchId, occurrenceId ?? "", id), out var document);
            return Task.FromResult(document is null ? null : Json.Clone(document));
        }
    }

    public Task<Creation<T>> Create(T document, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (gate)
        {
            if (documents.TryGetValue(Key(document), out var existing)) return Task.FromResult(new Creation<T>(Json.Clone(existing), false));
            document = AssignCode(document);
            var stored = (T)document with { ETag = $"\"{Guid.NewGuid():N}\"" };
            documents.Add(Key(document), Json.Clone(stored));
            return Task.FromResult(new Creation<T>(stored, true));
        }
    }

    public Task<T> Replace(T document, string etag, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (gate)
        {
            if (!documents.TryGetValue(Key(document), out var existing)) throw new ApiException(404, "not_found", "Resource not found.");
            if (string.IsNullOrEmpty(etag) || etag != existing.ETag) throw new ApiException(412, "stale_version", "ETag is stale.");
            document = AssignCode(document, existing);
            var stored = (T)document with { ETag = $"\"{Guid.NewGuid():N}\"" };
            documents[Key(document)] = Json.Clone(stored);
            return Task.FromResult(stored);
        }
    }

    public Task<Page<T>> Search(Query query, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        query.Validate();
        var after = Cursor.Decode<T>(query);
        lock (gate)
        {
            var results = documents.Values.Where(query.Matches)
                .Where(document => after is null || string.CompareOrdinal(document.Id, after) > 0)
                .OrderBy(document => document.Id, StringComparer.Ordinal).Take(query.PageSize + 1).ToArray();
            var page = results.Take(query.PageSize).Select(Json.Clone).ToArray();
            return Task.FromResult(new Page<T>(page, results.Length > query.PageSize ? Cursor.Encode<T>(query, page[^1].Id) : null));
        }
    }
}