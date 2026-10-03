using System.Collections.Specialized;
using System.Globalization;
using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;

namespace JChurch.Functions.Api;

internal sealed record UserQuery(Query Query, string? Role, string? Status, string? ChurchId);

internal static class QueryParsing
{
    internal static UserQuery ParseUserQuery(NameValueCollection values)
    {
        var allowed = new[] { "search", "role", "status", "churchId", "includeArchived", "pageSize", "continuationToken" };
        foreach (var key in values.AllKeys)
            if (key is null || !allowed.Contains(key) || values.GetValues(key)?.Length != 1) throw new ApiException(400, "invalid_query", "Unknown or repeated query parameter.");
        var role = values["role"];
        if (role is not null && role is not ("global-admin" or "church-admin" or "user")) throw new ApiException(400, "invalid_query", "role must be global-admin, church-admin, or user.");
        var status = values["status"];
        if (status is not null && status is not ("invited" or "active")) throw new ApiException(400, "invalid_query", "status must be invited or active.");
        bool Flag(string name) => values[name] is not { } value ? false : bool.TryParse(value, out var parsed) ? parsed : throw new ApiException(400, "invalid_query", $"{name} must be true or false.");
        var query = new Query
        {
            ChurchId = User.GlobalPartition, Search = values["search"],
            ActiveOnly = !Flag("includeArchived"),
            ContinuationToken = values["continuationToken"],
            PageSize = values["pageSize"] is not { } size ? 50 : int.TryParse(size, out var sizeParsed) ? sizeParsed : throw new ApiException(400, "invalid_query", "Invalid pageSize.")
        };
        query.Validate();
        return new UserQuery(query, role, status, values["churchId"]);
    }

    internal static Query ParseQuery(NameValueCollection values, string churchId, bool attendance = false, bool memberSort = false)
    {
        var allowed = new[] { "search", "eventId", "occurrenceId", "memberId", "groupId", "groupIds", "parentGroupId", "includeSubgroups", "includeArchived", "from", "to", "pageSize", "continuationToken", "nameSort", "createdOnSort" };
        foreach (var key in values.AllKeys)
            if (key is null || !allowed.Contains(key) || (key != "groupIds" && values.GetValues(key)?.Length != 1)) throw new ApiException(400, "invalid_query", "Unknown or repeated query parameter.");
        if (!memberSort && (values["nameSort"] is not null || values["createdOnSort"] is not null))
            throw new ApiException(400, "invalid_query", "Member sorting is only supported on the member list.");
        bool Flag(string name) => values[name] is not { } value ? false : bool.TryParse(value, out var parsed) ? parsed : throw new ApiException(400, "invalid_query", $"{name} must be true or false.");
        DateTimeOffset? Date(string name) => values[name] is not { } value ? null : DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ? parsed.ToUniversalTime() : throw new ApiException(400, "invalid_query", $"Invalid {name} timestamp.");
        var query = new Query
        {
            ChurchId = churchId, Search = values["search"], EventId = values["eventId"], OccurrenceId = values["occurrenceId"], MemberId = values["memberId"], GroupId = values["groupId"], GroupIds = (values.GetValues("groupIds") ?? []).SelectMany(value => value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).Distinct(StringComparer.Ordinal).ToArray(), ParentGroupId = values["parentGroupId"],
            IncludeSubgroups = Flag("includeSubgroups"), ActiveOnly = !Flag("includeArchived"), From = Date("from"), To = Date("to"), ContinuationToken = values["continuationToken"],
            NameSort = values["nameSort"] ?? "asc", CreatedOnSort = values["createdOnSort"],
            PageSize = values["pageSize"] is not { } size ? 50 : int.TryParse(size, out var parsed) ? parsed : throw new ApiException(400, "invalid_query", "Invalid pageSize.")
        };
        if (attendance && query.MemberId is null && query.From is not null && query.To is not null)
            DirectoryService.Require(query.To - query.From <= TimeSpan.FromDays(93), "Attendance report ranges must not exceed 93 days.");
        query.Validate();
        return query;
    }

    // Parses filters for the attendance summary endpoint. No pagination keys and no 93-day cap: aggregated
    // payloads stay small regardless of range, so multi-year summaries are allowed.
    internal static (Query Query, string GroupBy) ParseSummaryQuery(NameValueCollection values, string churchId)
    {
        var allowed = new[] { "groupBy", "eventId", "occurrenceId", "memberId", "groupId", "includeSubgroups", "from", "to" };
        foreach (var key in values.AllKeys)
            if (key is null || !allowed.Contains(key) || values.GetValues(key)?.Length != 1) throw new ApiException(400, "invalid_query", "Unknown or repeated query parameter.");
        var groupBy = values["groupBy"];
        if (groupBy is not ("event" or "occurrence" or "member" or "group" or "day")) throw new ApiException(400, "invalid_query", "groupBy must be event, occurrence, member, group, or day.");
        bool Flag(string name) => values[name] is not { } value ? false : bool.TryParse(value, out var parsed) ? parsed : throw new ApiException(400, "invalid_query", $"{name} must be true or false.");
        DateTimeOffset? Date(string name) => values[name] is not { } value ? null : DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ? parsed.ToUniversalTime() : throw new ApiException(400, "invalid_query", $"Invalid {name} timestamp.");
        var query = new Query
        {
            ChurchId = churchId, EventId = values["eventId"], OccurrenceId = values["occurrenceId"], MemberId = values["memberId"], GroupId = values["groupId"],
            IncludeSubgroups = Flag("includeSubgroups"), From = Date("from"), To = Date("to")
        };
        query.Validate();
        return (query, groupBy);
    }
}
