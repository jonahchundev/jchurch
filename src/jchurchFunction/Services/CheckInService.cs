using JChurch.Domain;
using JChurch.Storage;

namespace JChurch.Services;

public sealed class CheckInService(Repositories repositories, DirectoryService directory, TimeProvider clock)
{
    public async Task<Member> ResolveScan(string churchId, string code, CancellationToken cancellationToken = default)
    {
        await directory.ActiveChurch(churchId, cancellationToken);
        return await repositories.Members.ResolveScanCode(churchId, code, cancellationToken) ?? throw ScanCodes.NotFound();
    }

    public static string ReceiptId(string occurrenceId, string memberId) => $"{occurrenceId}_{memberId}";

    public async Task<Attendance?> Status(string churchId, string occurrenceId, string memberId, CancellationToken cancellationToken = default)
    {
        await directory.Get<Church>(churchId, churchId, cancellationToken: cancellationToken);
        await directory.Get<Occurrence>(churchId, occurrenceId, cancellationToken: cancellationToken);
        await directory.Get<Member>(churchId, memberId, cancellationToken: cancellationToken);
        return await repositories.Attendance.Get(churchId, ReceiptId(occurrenceId, memberId), occurrenceId, cancellationToken);
    }

    public async Task<Creation<Attendance>> CheckIn(string churchId, string occurrenceId, string memberId, CancellationToken cancellationToken = default)
    {
        DirectoryService.ValidateId(churchId);
        DirectoryService.ValidateId(occurrenceId);
        DirectoryService.ValidateId(memberId);
        var id = ReceiptId(occurrenceId, memberId);
        var receipt = await repositories.Attendance.Get(churchId, id, occurrenceId, cancellationToken);
        if (receipt is not null) return new(receipt, false);
        await directory.ActiveChurch(churchId, cancellationToken);
        var member = await directory.Get<Member>(churchId, memberId, true, cancellationToken);
        var occurrence = await directory.Get<Occurrence>(churchId, occurrenceId, true, cancellationToken);
        await directory.Get<ChurchEvent>(churchId, occurrence.EventId, true, cancellationToken);
        var now = clock.GetUtcNow();
        if (occurrence.Cancelled)
            throw new ApiException(409, "check_in_closed", "The occurrence is cancelled.");
        var inclusiveGroups = new HashSet<string>(member.GroupIds, StringComparer.Ordinal);
        foreach (var groupId in member.GroupIds)
        {
            var group = await directory.Get<Group>(churchId, groupId, cancellationToken: cancellationToken);
            if (group.ParentGroupId is not null) inclusiveGroups.Add(group.ParentGroupId);
        }
        return await repositories.Attendance.Create(new Attendance
        {
            Id = id, ChurchId = churchId, EventId = occurrence.EventId, OccurrenceId = occurrenceId,
            MemberId = memberId, CheckedInAt = now, GroupIds = member.GroupIds.ToArray(), InclusiveGroupIds = inclusiveGroups.Order().ToArray()
        }, cancellationToken);
    }
}