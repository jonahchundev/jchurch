using System.Security.Cryptography;
using System.Text;
using Ical.Net;
using Ical.Net.CalendarComponents;
using Ical.Net.DataTypes;
using Ical.Net.Evaluation;
using JChurch.Domain;
using JChurch.Storage;
using Occurrence = JChurch.Domain.Occurrence;

namespace JChurch.Services;

public sealed class EventService(Repositories repositories, DirectoryService directory, TimeProvider clock)
{
    public static IReadOnlyList<Occurrence> Expand(ChurchEvent definition, DateTimeOffset from, DateTimeOffset to)
    {
        DirectoryService.Require(to > from && to - from <= TimeSpan.FromDays(100), "Generation window must be at most 100 days.");
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(definition.TimeZone);
            DirectoryService.Require(!zone.IsInvalidTime(definition.LocalStart) && !zone.IsAmbiguousTime(definition.LocalStart), "Initial local start must be unambiguous and exist in the selected timezone.");
            var calendarEvent = new CalendarEvent { DtStart = new CalDateTime(definition.LocalStart, definition.TimeZone) };
            if (definition.RecurrenceRule is not null)
            {
                DirectoryService.Require(definition.RecurrenceRule.Length <= 500, "Recurrence rule is too long.");
                var pattern = new RecurrencePattern(definition.RecurrenceRule);
                DirectoryService.Require(pattern.Frequency is FrequencyType.Daily or FrequencyType.Weekly or FrequencyType.Monthly or FrequencyType.Yearly, "Only daily, weekly, monthly, and yearly recurrence is supported.");
                DirectoryService.Require(pattern.Interval is >= 1 and <= 365, "Recurrence interval must be between 1 and 365.");
                DirectoryService.Require(pattern.ByHour.Count == 0 && pattern.ByMinute.Count == 0 && pattern.BySecond.Count == 0, "Sub-day recurrence modifiers are not supported.");
                calendarEvent.RecurrenceRule = pattern;
            }
            var results = new List<Occurrence>();
            foreach (var occurrence in calendarEvent.GetOccurrences(new CalDateTime(from.UtcDateTime), new EvaluationOptions { MaxUnmatchedIncrementsLimit = 1000 }))
            {
                var start = new DateTimeOffset(DateTime.SpecifyKind(occurrence.Period.StartTime.AsUtc, DateTimeKind.Utc));
                if (start >= to) break;
                if (start < from) continue;
                var local = TimeZoneInfo.ConvertTime(start, zone).DateTime;
                if (zone.IsInvalidTime(local)) continue;
                var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{definition.Id}|{start.UtcTicks}"))).ToLowerInvariant();
                results.Add(new Occurrence { Id = $"occ_{hash}", ChurchId = definition.ChurchId, EventId = definition.Id, StartsAt = start, EndsAt = start.AddMinutes(definition.DurationMinutes) });
                DirectoryService.Require(results.Count <= 500, "Too many occurrences in the generation window.");
            }
            return results;
        }
        catch (Exception error) when (error is ArgumentException or FormatException or TimeZoneNotFoundException or InvalidTimeZoneException or EvaluationLimitExceededException)
        {
            throw new ApiException(400, "invalid_recurrence", "Invalid timezone or recurrence rule.");
        }
    }

    public async Task<ChurchEvent> Save(ChurchEvent input, string churchId, string? id = null, string? etag = null, CancellationToken cancellationToken = default)
    {
        await directory.ActiveChurch(churchId, cancellationToken);
        DirectoryService.Name(input.Name, "name");
        DirectoryService.Require(input.Active, "Use DELETE to archive events.");
        DirectoryService.Require(input.DurationMinutes is >= 1 and <= 10080, "durationMinutes must be between 1 and 10080.");
        DirectoryService.Require(input.LocalStart.Kind == DateTimeKind.Unspecified && input.LocalStart.Year is >= 2000 and <= 2100, "localStart must be a timezone-free local date/time between 2000 and 2100.");
        DirectoryService.Require(!string.IsNullOrWhiteSpace(input.TimeZone) && input.TimeZone.Length <= 100, "A timezone is required.");
        var groupIds = await ValidateGroups(churchId, input.GroupIds, cancellationToken);
        var definition = input with { Id = id ?? $"event_{Guid.NewGuid():N}", ChurchId = churchId, ETag = "", GroupIds = groupIds, SearchText = input.Name.Trim() };
        var now = clock.GetUtcNow();
        Expand(definition, now.AddDays(-7), now.AddDays(90));
        if (id is not null)
        {
            var existing = await directory.Get<ChurchEvent>(churchId, id, true, cancellationToken);
            DirectoryService.Require(existing.LocalStart == definition.LocalStart && existing.TimeZone == definition.TimeZone && existing.DurationMinutes == definition.DurationMinutes && existing.RecurrenceRule == definition.RecurrenceRule,
                "Event schedules are immutable. Override/cancel individual future occurrences, or create a replacement event.");
            return await repositories.Events.Replace(definition, etag!, cancellationToken);
        }
        return (await repositories.Events.Create(definition, cancellationToken)).Item;
    }

    public async Task<Occurrence?> Generate(string churchId, string eventId, CancellationToken cancellationToken = default)
    {
        await directory.ActiveChurch(churchId, cancellationToken);
        var definition = await directory.Get<ChurchEvent>(churchId, eventId, true, cancellationToken);
        var now = clock.GetUtcNow();
        var occurrences = Expand(definition, now.AddDays(-7), now.AddDays(90));
        var candidates = definition.RecurrenceRule is null
            ? occurrences
            : occurrences.Where(item => item.StartsAt >= now);
        foreach (var occurrence in candidates.OrderBy(item => item.StartsAt))
        {
            if (await repositories.Occurrences.Get(churchId, occurrence.Id, cancellationToken: cancellationToken) is not null)
                continue;
            var created = await repositories.Occurrences.Create(occurrence with { GroupIds = definition.GroupIds }, cancellationToken);
            if (created.Created)
                return created.Item;
        }
        return null;
    }

    public async Task<Occurrence> Override(string churchId, string id, DateTimeOffset startsAt, DateTimeOffset endsAt, bool cancelled, bool archived, string etag, CancellationToken cancellationToken = default, string[]? groupIds = null)
    {
        await directory.ActiveChurch(churchId, cancellationToken);
        var existing = await directory.Get<Occurrence>(churchId, id, true, cancellationToken);
        var effectiveGroups = groupIds is null ? existing.GroupIds : await ValidateGroups(churchId, groupIds, cancellationToken);
        var now = clock.GetUtcNow();
        var scheduleChanged = startsAt != existing.StartsAt || endsAt != existing.EndsAt || cancelled != existing.Cancelled;
        if (archived != existing.Archived)
        {
            DirectoryService.Require(existing.EndsAt <= now, "Only completed occurrences can be archived or restored.");
            DirectoryService.Require(!scheduleChanged, "Archiving cannot change a session's schedule or cancellation state.");
            return await repositories.Occurrences.Replace(existing with { Archived = archived, GroupIds = effectiveGroups }, etag, cancellationToken);
        }
        if (!scheduleChanged && groupIds is not null && !existing.Cancelled)
        {
            DirectoryService.Require(existing.EndsAt > now, "Only current or future occurrences can change check-in groups.");
            return await repositories.Occurrences.Replace(existing with { GroupIds = effectiveGroups, Overridden = true }, etag, cancellationToken);
        }
        DirectoryService.Require(existing.StartsAt > now, "Started or historical occurrences cannot be changed.");
        DirectoryService.Require(endsAt > startsAt && endsAt - startsAt <= TimeSpan.FromDays(7) && startsAt > now, "Override must be a future window of at most seven days.");
        return await repositories.Occurrences.Replace(existing with { StartsAt = startsAt.ToUniversalTime(), EndsAt = endsAt.ToUniversalTime(), Cancelled = cancelled, GroupIds = effectiveGroups, Overridden = true }, etag, cancellationToken);
    }

    private async Task<string[]> ValidateGroups(string churchId, string[] groupIds, CancellationToken cancellationToken)
    {
        DirectoryService.Require(groupIds is not null && groupIds.Length <= 50 && groupIds.All(groupId => !string.IsNullOrWhiteSpace(groupId)), "At most 50 valid group IDs are allowed.");
        var normalized = (groupIds ?? []).Distinct(StringComparer.Ordinal).ToArray();
        foreach (var groupId in normalized) await directory.Get<Group>(churchId, groupId, true, cancellationToken);
        return normalized;
    }
}