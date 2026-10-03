using JChurch.Domain;
using System.Text.Json;

namespace JChurch.Storage;

public sealed class InMemoryRepository<T> : IRepository<T> where T : Document
{
    private sealed record MemberPosition(DateTimeOffset? CreatedOn, string LastName, string FirstName, string Id);

    private readonly TimeProvider timeProvider;
    private readonly object gate = new();
    private readonly Dictionary<(string Church, string Occurrence, string Id), T> documents = [];
    private readonly Dictionary<(string Church, string Code), string> scanOwners = [];

    public InMemoryRepository(TimeProvider? timeProvider = null) => this.timeProvider = timeProvider ?? TimeProvider.System;

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
            var now = timeProvider.GetUtcNow();
            Document stamped = (Document)document with { CreatedOn = now, UpdatedOn = now };
            document = (T)stamped;
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
            Document stamped = (Document)document with { CreatedOn = existing.CreatedOn, UpdatedOn = timeProvider.GetUtcNow() };
            document = (T)stamped;
            var stored = (T)document with { ETag = $"\"{Guid.NewGuid():N}\"" };
            documents[Key(document)] = Json.Clone(stored);
            return Task.FromResult(stored);
        }
    }

    // Ascending order: Members by name, everything else by id; \u001F sorts below any name character so ordinal string compare preserves tuple order.
    private static string SortKey(T document) => document is Member member ? $"{member.LastName}\u001F{member.FirstName}\u001F{member.Id}" : document.Id;

    private static int CompareMembers(Member left, Member right, Query query)
    {
        if (query.CreatedOnSort is not null)
        {
            var leftUnknown = left.CreatedOn is null;
            var rightUnknown = right.CreatedOn is null;
            if (leftUnknown != rightUnknown) return leftUnknown ? 1 : -1;
            if (!leftUnknown)
            {
                var date = left.CreatedOn!.Value.CompareTo(right.CreatedOn!.Value);
                if (date != 0) return query.CreatedOnSort == "newest" ? -date : date;
            }
        }
        var direction = query.NameSort == "desc" ? -1 : 1;
        var last = string.CompareOrdinal(left.LastName, right.LastName);
        if (last != 0) return direction * last;
        var first = string.CompareOrdinal(left.FirstName, right.FirstName);
        if (first != 0) return direction * first;
        return direction * string.CompareOrdinal(left.Id, right.Id);
    }

    private static MemberPosition Position(Member member) => new(member.CreatedOn, member.LastName, member.FirstName, member.Id);

    private static MemberPosition DecodeMemberPosition(string value) =>
        JsonSerializer.Deserialize<MemberPosition>(value, Json.Options)
        ?? throw new ApiException(400, "invalid_cursor", "Invalid continuation token.");

    public Task<Page<T>> Search(Query query, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        query.Validate();
        var after = Cursor.Decode<T>(query);
        lock (gate)
        {
            if (typeof(T) == typeof(Member))
            {
                var position = after is null ? null : DecodeMemberPosition(after);
                var memberResults = documents.Values.Where(query.Matches).Cast<Member>()
                    .Where(member => position is null || CompareMembers(member, new Member
                    {
                        CreatedOn = position.CreatedOn, LastName = position.LastName, FirstName = position.FirstName, Id = position.Id
                    }, query) > 0)
                    .OrderBy(member => member, Comparer<Member>.Create((left, right) => CompareMembers(left, right, query)))
                    .Take(query.PageSize + 1).ToArray();
                var memberPage = memberResults.Take(query.PageSize).Select(member => (T)(Document)Json.Clone(member)).ToArray();
                var next = memberResults.Length > query.PageSize
                    ? Cursor.Encode<T>(query, JsonSerializer.Serialize(Position(memberResults[query.PageSize - 1]), Json.Options))
                    : null;
                return Task.FromResult(new Page<T>(memberPage, next));
            }
            var results = documents.Values.Where(query.Matches)
                .Where(document => after is null || string.CompareOrdinal(SortKey(document), after) > 0)
                .OrderBy(SortKey, StringComparer.Ordinal).Take(query.PageSize + 1).ToArray();
            var page = results.Take(query.PageSize).Select(Json.Clone).ToArray();
            return Task.FromResult(new Page<T>(page, results.Length > query.PageSize ? Cursor.Encode<T>(query, SortKey(results[query.PageSize - 1])) : null));
        }
    }

    public Task<IReadOnlyList<OccurrenceCheckInCount>> ActiveCheckInCounts(string churchId, string eventId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (typeof(T) != typeof(Attendance)) throw new NotSupportedException("Check-in counts require an attendance repository.");
        lock (gate)
        {
            var counts = documents.Values.OfType<Attendance>()
                .Where(receipt => receipt.ChurchId == churchId && receipt.EventId == eventId && receipt.Active)
                .GroupBy(receipt => receipt.OccurrenceId, StringComparer.Ordinal)
                .Select(group => new OccurrenceCheckInCount(group.Key, group.Count()))
                .OrderBy(count => count.OccurrenceId, StringComparer.Ordinal)
                .ToArray();
            return Task.FromResult<IReadOnlyList<OccurrenceCheckInCount>>(counts);
        }
    }

    public Task<T> Transfer(string churchId, string loserId, string loserEtag, T keeper, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (typeof(T) != typeof(Attendance)) throw new NotSupportedException("Transfer requires an attendance repository.");
        var keeperAttendance = (Attendance)(Document)keeper;
        var loserKey = (churchId, keeperAttendance.OccurrenceId, loserId);
        lock (gate)
        {
            if (!documents.TryGetValue(loserKey, out var loser)) throw new ApiException(404, "not_found", "The check-in to move was not found.");
            if (string.IsNullOrEmpty(loserEtag) || loserEtag != loser.ETag) throw new ApiException(412, "stale_version", "ETag is stale.");
            var keeperKey = Key(keeper);
            if (documents.ContainsKey(keeperKey)) throw new ApiException(409, "already_exists", "The kept member already has a check-in for this occurrence.");
            var now = timeProvider.GetUtcNow();
            Document stamped = (Document)keeper with { CreatedOn = now, UpdatedOn = now };
            var stored = (T)stamped with { ETag = $"\"{Guid.NewGuid():N}\"" };
            documents.Remove(loserKey);
            documents.Add(keeperKey, Json.Clone(stored));
            return Task.FromResult(stored);
        }
    }

    public Task Purge(string churchId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (gate)
        {
            foreach (var key in documents.Keys.Where(key => key.Church == churchId).ToArray()) documents.Remove(key);
            foreach (var key in scanOwners.Keys.Where(key => key.Church == churchId).ToArray()) scanOwners.Remove(key);
        }
        return Task.CompletedTask;
    }
}