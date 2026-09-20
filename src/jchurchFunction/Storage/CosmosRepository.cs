using System.Net;
using System.Text.Json;
using JChurch.Domain;
using Microsoft.Azure.Cosmos;

namespace JChurch.Storage;

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

public sealed class CosmosRepository<T>(CosmosClient client, CosmosSettings settings) : IRepository<T> where T : Document
{
    private readonly Container container = client.GetContainer(settings.Database, typeof(T) == typeof(Attendance) ? "attendance" : "directory");

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
        if (etag is not null)
        {
            existing = (Member?)(Document?)await Get(member.ChurchId, member.Id, cancellationToken: cancellationToken);
            if (existing is null) throw new ApiException(404, "not_found", "Resource not found.");
            if (existing.ETag != etag) throw new ApiException(412, "stale_version", "ETag is stale.");
        }
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
        using var iterator = container.GetItemQueryIterator<T>(BuildQuery(query), continuation, new QueryRequestOptions
        {
            PartitionKey = typeof(T) == typeof(Church) && query.ChurchId == "" ? null : Partition(query.ChurchId, query.OccurrenceId),
            MaxItemCount = query.PageSize
        });
        try
        {
            var result = await iterator.ReadNextAsync(cancellationToken);
            return new(result.ToArray(), result.ContinuationToken is null ? null : Cursor.Encode<T>(query, result.ContinuationToken));
        }
        catch (CosmosException error) when (error.StatusCode == HttpStatusCode.BadRequest && continuation is not null)
        {
            throw new ApiException(400, "invalid_cursor", "Invalid continuation token.");
        }
    }

    public static QueryDefinition BuildQuery(Query query)
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
        var definition = new QueryDefinition($"SELECT * FROM c WHERE {string.Join(" AND ", clauses)} ORDER BY c.id");
        foreach (var parameter in parameters) definition.WithParameter(parameter.Key, parameter.Value);
        return definition;
    }
}

public sealed record CosmosSettings(string Endpoint, string Database);