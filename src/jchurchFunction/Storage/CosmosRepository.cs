using System.Net;
using System.Text.Json;
using JChurch.Domain;
using Microsoft.Azure.Cosmos;

namespace JChurch.Storage;
/// <summary>
/// Custom JSON serializer for Cosmos DB that handles unmapped members and type validation.
/// </summary>
public sealed class CosmosJsonSerializer : CosmosSerializer
{
    private static readonly JsonSerializerOptions Options = new(Json.Options)
    {
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Skip
    };

    public override T FromStream<T>(Stream stream)
    {
        using (stream)
        {
            using var json = JsonDocument.Parse(stream);
            if (typeof(Document).IsAssignableFrom(typeof(T)) &&
                (!json.RootElement.TryGetProperty("kind", out var kind) || kind.GetString() != typeof(T).Name))
                throw new ApiException(404, "not_found", "Resource type does not match the requested route.");
            return json.RootElement.Deserialize<T>(Options)!;
        }
    }

    public override Stream ToStream<T>(T input) => new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(input, Options));
}

public sealed class CosmosRepository<T>(CosmosClient client, CosmosSettings settings, TimeProvider? timeProvider = null) : IRepository<T> where T : Document
{
    private sealed record MemberDatePosition(int Phase, string? ContinuationToken);
    private sealed record AttendanceMemberSummaryRow(string Key, int CheckedInCount);

    private readonly Container container = client.GetContainer(settings.Database, typeof(T) == typeof(Attendance) ? "attendance" : "directory");
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;

    private static PartitionKey Partition(string churchId, string? occurrenceId = null) => typeof(T) == typeof(Attendance)
        ? occurrenceId is null
            ? new PartitionKeyBuilder().Add(churchId).Build()
            : new PartitionKeyBuilder().Add(churchId).Add(occurrenceId).Build()
        : new PartitionKey(churchId);

    public async Task<T?> Get(string churchId, string id, string? occurrenceId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await container.ReadItemAsync<T>(id, Partition(churchId, occurrenceId), cancellationToken: cancellationToken);
            return result.Resource;
        }
        catch (CosmosException error) when (error.StatusCode == HttpStatusCode.NotFound) { return null; }
    }

    public async Task<Creation<T>> Create(T document, CancellationToken cancellationToken = default)
    {
        if (document is Member member)
        {
            var existing = await Get(member.ChurchId, member.Id, cancellationToken: cancellationToken);
            if (existing is not null) return new(existing, false);
            return new((T)(Document)await SaveMember(member, null, cancellationToken), true);
        }
        var occurrenceId = (document as Attendance)?.OccurrenceId;
        var now = clock.GetUtcNow();
        Document stamped = (Document)document with { CreatedOn = now, UpdatedOn = now };
        document = (T)stamped;
        try
        {
            var result = await container.CreateItemAsync(document, Partition(document.ChurchId, occurrenceId), cancellationToken: cancellationToken);
            return new(result.Resource, true);
        }
        catch (CosmosException error) when (error.StatusCode == HttpStatusCode.Conflict)
        {
            var existing = await Get(document.ChurchId, document.Id, occurrenceId, cancellationToken);
            if (existing is null) throw;
            return new(existing, false);
        }
    }

    public async Task<T> Replace(T document, string etag, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(etag) || etag == "*") throw new ApiException(412, "stale_version", "An exact ETag is required.");
        if (document is Member member)
            return (T)(Document)await SaveMember(member, etag, cancellationToken);
        var existing = await Get(document.ChurchId, document.Id, (document as Attendance)?.OccurrenceId, cancellationToken);
        if (existing is null) throw new ApiException(404, "not_found", "Resource not found.");
        if (existing.ETag != etag) throw new ApiException(412, "stale_version", "ETag is stale.");
        Document stamped = (Document)document with { CreatedOn = existing.CreatedOn, UpdatedOn = clock.GetUtcNow() };
        document = (T)stamped;
        try
        {
            var result = await container.ReplaceItemAsync(document, document.Id, Partition(document.ChurchId, (document as Attendance)?.OccurrenceId),
                new ItemRequestOptions { IfMatchEtag = etag }, cancellationToken);
            return result.Resource;
        }
        catch (CosmosException error) when (error.StatusCode is HttpStatusCode.PreconditionFailed or HttpStatusCode.NotFound)
        {
            throw new ApiException((int)error.StatusCode, error.StatusCode == HttpStatusCode.NotFound ? "not_found" : "stale_version", "Resource missing or ETag is stale.");
        }
    }

    private async Task<Member> SaveMember(Member input, string? etag, CancellationToken cancellationToken)
    {
        var member = ScanCodes.Normalize(input);
        Member? existing = null;
        var now = clock.GetUtcNow();
        if (etag is not null)
        {
            existing = (Member?)(Document?)await Get(member.ChurchId, member.Id, cancellationToken: cancellationToken);
            if (existing is null) throw new ApiException(404, "not_found", "Resource not found.");
            if (existing.ETag != etag) throw new ApiException(412, "stale_version", "ETag is stale.");
            member = member with { CreatedOn = existing.CreatedOn, UpdatedOn = now };
        }
        else member = member with { CreatedOn = now, UpdatedOn = now };
        var batch = container.CreateTransactionalBatch(Partition(member.ChurchId));
        if (etag is null) batch.CreateItem(member);
        else batch.ReplaceItem(member.Id, member, new TransactionalBatchItemRequestOptions { IfMatchEtag = etag });
        if (existing?.ScanCode != member.ScanCode)
        {
            if (member.ScanCode is { } code)
                batch.CreateItem(new ScanCodeLookup { Id = ScanCodes.LookupId(code), ChurchId = member.ChurchId, MemberId = member.Id });
            if (existing?.ScanCode is { } oldCode) batch.DeleteItem(ScanCodes.LookupId(oldCode));
        }
        using var response = await batch.ExecuteAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            for (var index = 0; index < response.Count; index++)
            {
                var status = response[index].StatusCode;
                if (status == HttpStatusCode.Conflict && index > 0) throw ScanCodes.Conflict();
                if (status == HttpStatusCode.PreconditionFailed) throw new ApiException(412, "stale_version", "ETag is stale.");
                if (status == HttpStatusCode.Conflict) throw new ApiException(409, "already_exists", "Resource already exists.");
            }
            throw new CosmosException("Member assignment transaction failed.", response.StatusCode, 0, response.ActivityId, response.RequestCharge);
        }
        return response.GetOperationResultAtIndex<Member>(0).Resource;
    }

    public async Task<Member?> ResolveScanCode(string churchId, string code, CancellationToken cancellationToken = default)
    {
        var canonical = ScanCodes.Normalize(code);
        var options = new ItemRequestOptions { ConsistencyLevel = ConsistencyLevel.Strong };
        try
        {
            var lookup = await container.ReadItemAsync<ScanCodeLookup>(ScanCodes.LookupId(canonical), Partition(churchId), options, cancellationToken);
            var member = (await container.ReadItemAsync<Member>(lookup.Resource.MemberId, Partition(churchId), options, cancellationToken)).Resource;
            return member.Active && member.ScanCode == canonical ? member : null;
        }
        catch (CosmosException error) when (error.StatusCode == HttpStatusCode.NotFound) { return null; }
    }

    public async Task<Page<T>> Search(Query query, CancellationToken cancellationToken = default)
    {
        query.Validate();
        var continuation = Cursor.Decode<T>(query);
        var dateSort = typeof(T) == typeof(Member) && query.CreatedOnSort is not null;
        var datePosition = dateSort ? DecodeMemberDatePosition(continuation) : null;
        var phase = datePosition?.Phase ?? 0;
        var cosmosContinuation = datePosition?.ContinuationToken ?? (dateSort ? null : continuation);
        using var iterator = container.GetItemQueryIterator<T>(BuildQuery(query, dateSort ? phase : null), cosmosContinuation, new QueryRequestOptions
        {
            PartitionKey = typeof(T) == typeof(Church) && query.ChurchId == "" ? null : Partition(query.ChurchId, query.OccurrenceId),
            MaxItemCount = query.PageSize
        });
        try
        {
            var result = await iterator.ReadNextAsync(cancellationToken);
            var nextPosition = dateSort
                ? result.ContinuationToken is not null
                    ? JsonSerializer.Serialize(new MemberDatePosition(phase, result.ContinuationToken), Json.Options)
                    : phase == 0 ? JsonSerializer.Serialize(new MemberDatePosition(1, null), Json.Options) : null
                : result.ContinuationToken;
            return new(result.ToArray(), nextPosition is null ? null : Cursor.Encode<T>(query, nextPosition));
        }
        catch (CosmosException error) when (error.StatusCode == HttpStatusCode.BadRequest && continuation is not null)
        {
            throw new ApiException(400, "invalid_cursor", "Invalid continuation token.");
        }
    }

    public async Task<IReadOnlyList<OccurrenceCheckInCount>> ActiveCheckInCounts(string churchId, string eventId, CancellationToken cancellationToken = default)
    {
        if (typeof(T) != typeof(Attendance)) throw new NotSupportedException("Check-in counts require an attendance repository.");
        var definition = new QueryDefinition("SELECT c.occurrenceId, COUNT(1) AS checkedInCount FROM c WHERE c.churchId = @churchId AND c.kind = 'Attendance' AND c.eventId = @eventId AND c.active = true GROUP BY c.occurrenceId")
            .WithParameter("@churchId", churchId)
            .WithParameter("@eventId", eventId);
        using var iterator = container.GetItemQueryIterator<OccurrenceCheckInCount>(definition, requestOptions: new QueryRequestOptions
        {
            PartitionKey = Partition(churchId)
        });
        var counts = new List<OccurrenceCheckInCount>();
        while (iterator.HasMoreResults)
            counts.AddRange(await iterator.ReadNextAsync(cancellationToken));
        return counts;
    }

    private const int MaxSummaryGroups = 10_000;

    public async Task<IReadOnlyList<AttendanceSummaryRow>> Summarize(Query query, string groupBy, CancellationToken cancellationToken = default)
    {
        if (typeof(T) != typeof(Attendance)) throw new NotSupportedException("Summaries require an attendance repository.");
        query.Validate();
        var (from, key, group) = groupBy switch
        {
            "event" => ("c", "c.eventId", "c.eventId"),
            "occurrence" => ("c", "c.occurrenceId", "c.occurrenceId"),
            "member" => ("c", "c.memberId", "c.memberId"),
            "day" => ("c", "SUBSTRING(c.checkedInAt, 0, 10)", "SUBSTRING(c.checkedInAt, 0, 10)"),
            "group" => ("c JOIN g IN c.inclusiveGroupIds", "g", "g"),
            _ => throw new ApiException(400, "invalid_query", "groupBy must be event, occurrence, member, group, or day.")
        };
        var (clauses, parameters) = BuildFilters(query, null);
        // Cosmos SQL does not support COUNT(DISTINCT ...). Grouping by member yields one row per
        // report key/member pair, so the final aggregation can count distinct members locally.
        var definition = new QueryDefinition($"SELECT {key} AS key, c.memberId, COUNT(1) AS checkedInCount FROM {from} WHERE {string.Join(" AND ", clauses)} GROUP BY {group}, c.memberId");
        foreach (var parameter in parameters) definition.WithParameter(parameter.Key, parameter.Value);
        using var iterator = container.GetItemQueryIterator<AttendanceMemberSummaryRow>(definition, requestOptions: new QueryRequestOptions
        {
            PartitionKey = Partition(query.ChurchId, query.OccurrenceId)
        });
        var memberRows = new List<AttendanceMemberSummaryRow>();
        while (iterator.HasMoreResults)
        {
            memberRows.AddRange(await iterator.ReadNextAsync(cancellationToken));
        }
        var rows = memberRows
            .GroupBy(row => row.Key, StringComparer.Ordinal)
            .Select(group => new AttendanceSummaryRow(group.Key, group.Sum(row => row.CheckedInCount), group.Count()))
            .ToList();
        if (rows.Count > MaxSummaryGroups) throw new ApiException(400, "too_many_results", "Summary produced too many groups; narrow the filters.");
        // GROUP BY results have no defined order; sort by key so summaries are deterministic across repositories.
        rows.Sort((left, right) => string.CompareOrdinal(left.Key, right.Key));
        return rows;
    }

    public async Task<T> Transfer(string churchId, string loserId, string loserEtag, T keeper, string? keeperEtag = null, CancellationToken cancellationToken = default)
    {
        if (typeof(T) != typeof(Attendance)) throw new NotSupportedException("Transfer requires an attendance repository.");
        if (string.IsNullOrWhiteSpace(loserEtag) || loserEtag == "*") throw new ApiException(412, "stale_version", "An exact ETag is required.");
        var keeperAttendance = (Attendance)(Document)keeper;
        if (keeperAttendance.OccurrenceId is null) throw new ApiException(400, "invalid_request", "A keeper occurrence is required.");
        var partition = Partition(churchId, keeperAttendance.OccurrenceId);
        var now = clock.GetUtcNow();
        Document stamped = (Document)keeper with { CreatedOn = now, UpdatedOn = now };
        var batch = container.CreateTransactionalBatch(partition)
            .DeleteItem(loserId, new TransactionalBatchItemRequestOptions { IfMatchEtag = loserEtag });
        // When the keeper's slot is occupied by an inactive receipt (e.g. an undone check-in), replace it
        // atomically in the same batch instead of creating a new document.
        batch = keeperEtag is null
            ? batch.CreateItem(stamped)
            : batch.ReplaceItem(stamped.Id, stamped, new TransactionalBatchItemRequestOptions { IfMatchEtag = keeperEtag });
        using var response = await batch.ExecuteAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var status = response.StatusCode;
            if (status is HttpStatusCode.NotFound) throw new ApiException(404, "not_found", "The check-in to move was not found.");
            if (status is HttpStatusCode.PreconditionFailed) throw new ApiException(412, "stale_version", "ETag is stale.");
            if (status is HttpStatusCode.Conflict) throw new ApiException(409, "already_exists", "The kept member already has a check-in for this occurrence.");
            throw new ApiException((int)status, "transfer_failed", "The check-in could not be moved.");
        }
        return keeper with { CreatedOn = now, UpdatedOn = now };
    }

    // Deletes every document for churchId in this container: for Attendance, a churchId-only partition key spans all occurrenceId sub-partitions.
    public async Task Purge(string churchId, CancellationToken cancellationToken = default)
    {
        var isAttendance = typeof(T) == typeof(Attendance);
        var partition = isAttendance ? new PartitionKeyBuilder().Add(churchId).Build() : Partition(churchId);
        var definition = new QueryDefinition(isAttendance
                ? "SELECT c.id, c.occurrenceId FROM c WHERE c.churchId = @churchId"
                : "SELECT c.id FROM c WHERE c.churchId = @churchId")
            .WithParameter("@churchId", churchId);
        using var iterator = container.GetItemQueryIterator<JsonElement>(definition, requestOptions: new QueryRequestOptions { PartitionKey = partition });
        var items = new List<(string Id, string? OccurrenceId)>();
        while (iterator.HasMoreResults)
        {
            var page = await iterator.ReadNextAsync(cancellationToken);
            items.AddRange(page.Select(element => (element.GetProperty("id").GetString()!, isAttendance ? element.GetProperty("occurrenceId").GetString() : null)));
        }
        await Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = cancellationToken }, async (item, token) =>
        {
            try
            {
                await container.DeleteItemAsync<object>(item.Id, Partition(churchId, item.OccurrenceId), cancellationToken: token);
            }
            catch (CosmosException error) when (error.StatusCode == HttpStatusCode.NotFound) { }
        });
    }

    public static QueryDefinition BuildQuery(Query query)
        => BuildQuery(query, typeof(T) == typeof(Member) && query.CreatedOnSort is not null ? 0 : null);

    private static QueryDefinition BuildQuery(Query query, int? memberDatePhase)
    {
        var (clauses, parameters) = BuildFilters(query, memberDatePhase);
        var nameDirection = query.NameSort == "desc" ? "DESC" : "ASC";
        var orderBy = typeof(T) == typeof(Member)
            ? memberDatePhase == 0
                ? $"c.createdOn {(query.CreatedOnSort == "newest" ? "DESC" : "ASC")}, c.lastName {nameDirection}, c.firstName {nameDirection}, c.id {nameDirection}"
                : $"c.lastName {nameDirection}, c.firstName {nameDirection}, c.id {nameDirection}"
            : "c.id";
        var definition = new QueryDefinition($"SELECT * FROM c WHERE {string.Join(" AND ", clauses)} ORDER BY {orderBy}");
        foreach (var parameter in parameters) definition.WithParameter(parameter.Key, parameter.Value);
        return definition;
    }

    // WHERE clauses + parameters shared by Search (BuildQuery) and Summarize. Contains no SELECT, ORDER BY, or pagination.
    private static (List<string> Clauses, Dictionary<string, object> Parameters) BuildFilters(Query query, int? memberDatePhase)
    {
        var clauses = new List<string> { "c.churchId = @churchId", "c.kind = @kind" };
        var parameters = new Dictionary<string, object> { ["@churchId"] = query.ChurchId, ["@kind"] = typeof(T).Name };
        if (typeof(T) == typeof(Church) && query.ChurchId == "")
        {
            clauses.Remove("c.churchId = @churchId");
            parameters.Remove("@churchId");
        }
        void Add(string? value, string field)
        {
            if (value is null) return;
            clauses.Add($"c.{field} = @{field}");
            parameters[$"@{field}"] = value;
        }
        Add(query.EventId, "eventId");
        Add(query.OccurrenceId, "occurrenceId");
        Add(query.MemberId, "memberId");
        Add(query.ParentGroupId, "parentGroupId");
        if (query.ActiveOnly) clauses.Add("c.active = true");
        if (query.Search is not null)
        {
            clauses.Add("CONTAINS(c.searchText, @search, true)");
            parameters["@search"] = query.Search;
        }
        if (query.GroupId is not null)
        {
            var field = query.IncludeSubgroups && typeof(T) == typeof(Attendance) ? "inclusiveGroupIds" : "groupIds";
            clauses.Add($"ARRAY_CONTAINS(c.{field}, @groupId)");
            parameters["@groupId"] = query.GroupId;
        }
        if (query.GroupIds.Length > 0)
        {
            var unionField = query.IncludeSubgroups && typeof(T) == typeof(Attendance) ? "inclusiveGroupIds" : "groupIds";
            clauses.Add($"({string.Join(" OR ", query.GroupIds.Select((_, index) => $"ARRAY_CONTAINS(c.{unionField}, @groupId{index})").ToArray())})");
            for (var index = 0; index < query.GroupIds.Length; index++) parameters[$"@groupId{index}"] = query.GroupIds[index];
        }
            if (memberDatePhase == 0) clauses.Add("IS_DEFINED(c.createdOn) AND NOT IS_NULL(c.createdOn)");
            else if (memberDatePhase == 1) clauses.Add("(NOT IS_DEFINED(c.createdOn) OR IS_NULL(c.createdOn))");
        var dateField = typeof(T) == typeof(Attendance) ? "checkedInAt" : "startsAt";
        if (query.From is not null)
        {
            clauses.Add($"c.{dateField} >= @from");
            parameters["@from"] = UtcDateTimeConverter.Format(query.From.Value);
        }
        if (query.To is not null)
        {
            clauses.Add($"c.{dateField} < @to");
            parameters["@to"] = UtcDateTimeConverter.Format(query.To.Value);
        }
        return (clauses, parameters);
    }

    private static MemberDatePosition? DecodeMemberDatePosition(string? encoded)
    {
        if (encoded is null) return null;
        try
        {
            var position = JsonSerializer.Deserialize<MemberDatePosition>(encoded, Json.Options);
            return position is { Phase: 0 or 1 } ? position : throw new JsonException();
        }
        catch (JsonException)
        {
            throw new ApiException(400, "invalid_cursor", "Invalid continuation token.");
        }
    }
}

public sealed record CosmosSettings(string Endpoint, string Database);