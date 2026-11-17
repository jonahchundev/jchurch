using JChurch.Domain;
using JChurch.Storage;
using Microsoft.Extensions.Logging;
using System.Diagnostics;

namespace JChurch.Services;

public sealed record MergePreview(int KeeperCheckIns, int LoserCheckIns, int Movable, int Skipped);
public sealed record MergeResult(string Kept, string Archived, int CheckInsMoved, int CheckInsSkipped);

/// <summary>
/// Merges a duplicate "loser" member into the "keeper": moves the loser's check-ins (preserving the original
/// CheckedInAt) and archives the loser. Transfer is count-preserving: a moved check-in atomically replaces the
/// loser's receipt with the keeper's in the same occurrence partition, so the occurrence's active total is unchanged.
/// When both members checked in to the same occurrence, the keeper's receipt is kept and the loser's copy archived
/// (the only case the occurrence count drops by one — a real dedupe).
/// </summary>
public sealed class MemberMergeService(Repositories repositories, DirectoryService directory, TimeProvider clock, ILogger<MemberMergeService>? logger = null)
{
    public async Task<MergePreview> Preview(string churchId, string keepId, string loserId, CancellationToken cancellationToken = default)
    {
        var (keeper, loser) = await LoadPair(churchId, keepId, loserId, cancellationToken);
        var keeperReceipts = await Receipts(churchId, keeper.Id, activeOnly: true, cancellationToken);
        var loserReceipts = await Receipts(churchId, loser.Id, activeOnly: true, cancellationToken);
        var keeperOccurrences = new HashSet<string>(keeperReceipts.Select(receipt => receipt.OccurrenceId), StringComparer.Ordinal);
        var movable = loserReceipts.Count(receipt => !keeperOccurrences.Contains(receipt.OccurrenceId));
        return new MergePreview(keeperReceipts.Count, loserReceipts.Count, movable, loserReceipts.Count - movable);
    }

    public async Task<MergeResult> Merge(string churchId, string keepId, string loserId, string loserEtag, Member? keeperUpdate, string keeperEtag, CancellationToken cancellationToken = default)
    {
        var (keeper, loser) = await LoadPair(churchId, keepId, loserId, cancellationToken);

        if (string.IsNullOrWhiteSpace(loserEtag) || loserEtag == "*" || loser.ETag != loserEtag)
            throw new ApiException(412, "stale_version", "The member being removed changed. Reload both members and review the merge.");
        if (keeperUpdate is not null && (string.IsNullOrWhiteSpace(keeperEtag) || keeperEtag == "*" || keeper.ETag != keeperEtag))
            throw new ApiException(412, "stale_version", "The kept member changed. Reload both members and review the merge.");

        // Optional per-field keeper update (validated exactly like a normal member save). If it takes the loser's
        // live scan code, release that code from the loser first (archiving alone does not release a ScanCodeLookup).
        if (keeperUpdate is not null)
        {
            if (keeperUpdate.ScanCode is { } code && string.Equals(ScanCodes.Normalize(code), loser.ScanCode, StringComparison.Ordinal))
                loser = await repositories.Members.Replace(loser with { ScanCode = null, ScanCodeFormat = null }, loser.ETag, cancellationToken);
            var updated = keeperUpdate with { Id = keeper.Id, ChurchId = churchId };
            keeper = await directory.Save(updated, churchId, keeper.Id, keeperEtag, cancellationToken);
        }

        var timer = Stopwatch.StartNew();
        var stage = "attendance";
        var moved = 0;
        var skipped = 0;
        try
        {
            var loserReceipts = await Receipts(churchId, loser.Id, activeOnly: true, cancellationToken);
            await Parallel.ForEachAsync(loserReceipts, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = cancellationToken }, async (receipt, token) =>
            {
                var outcome = await MergeReceipt(churchId, keeper.Id, loser.Id, receipt, token);
                if (outcome == "moved") Interlocked.Increment(ref moved);
                if (outcome == "deduplicated") Interlocked.Increment(ref skipped);
            });
            stage = "verify_attendance";
            var remaining = await repositories.Attendance.Search(new Query { ChurchId = churchId, MemberId = loser.Id, PageSize = 1 }, cancellationToken);
            while (remaining.Items.Count == 0 && remaining.ContinuationToken is not null)
                remaining = await repositories.Attendance.Search(new Query { ChurchId = churchId, MemberId = loser.Id, PageSize = 1, ContinuationToken = remaining.ContinuationToken }, cancellationToken);
            if (remaining.Items.Count != 0)
                throw new ApiException(409, "merge_incomplete", "Check-ins changed during the merge. Reload both members and review the remaining work.");

            stage = "archive";
            await directory.Archive<Member>(churchId, loser.Id, loser.ETag, cancellationToken);
            logger?.LogInformation("Member merge completed in {ElapsedMs} ms for church {ChurchId}, keeper {KeeperId}, removed {LoserId}; moved {Moved}, deduplicated {Skipped}",
                timer.ElapsedMilliseconds, churchId, keeper.Id, loser.Id, moved, skipped);
            return new MergeResult(keeper.Id, loser.Id, moved, skipped);
        }
        catch (Exception error)
        {
            logger?.LogWarning(error, "Member merge stopped at {Stage} after {ElapsedMs} ms for church {ChurchId}, keeper {KeeperId}, removed {LoserId}; moved {Moved}, deduplicated {Skipped}",
                stage, timer.ElapsedMilliseconds, churchId, keeper.Id, loser.Id, moved, skipped);
            if (error is ApiException failure)
                throw new ApiException(failure.Status, failure.Code,
                    $"Merge stopped during {stage}. Some check-ins may already have moved. Reload both members and review before continuing. {failure.Message}");
            throw;
        }
    }

    private async Task<string> MergeReceipt(string churchId, string keeperId, string loserId, Attendance original, CancellationToken cancellationToken)
    {
        if (original.OccurrenceId is not { } occurrenceId)
            throw new ApiException(409, "invalid_attendance", "A check-in has no occurrence and cannot be merged.");
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var receipt = await repositories.Attendance.Get(churchId, original.Id, occurrenceId, cancellationToken);
            var keeper = await repositories.Attendance.Get(churchId, CheckInService.ReceiptId(occurrenceId, keeperId), occurrenceId, cancellationToken);
            if (receipt is not { Active: true }) return "already_processed";
            try
            {
                if (keeper is { Active: true })
                {
                    await repositories.Attendance.Deduplicate(receipt with
                    {
                        Active = false,
                        Audit = [.. receipt.Audit, new AttendanceAuditEntry { Action = $"merged-to {keeperId} (duplicate)", OccurredAt = clock.GetUtcNow() }]
                    }, keeper, cancellationToken);
                    return "deduplicated";
                }
                var movedReceipt = receipt with
                {
                    Id = CheckInService.ReceiptId(occurrenceId, keeperId),
                    MemberId = keeperId,
                    ETag = "",
                    Audit = [.. receipt.Audit, new AttendanceAuditEntry { Action = $"merged-from {loserId}", OccurredAt = clock.GetUtcNow() }]
                };
                await repositories.Attendance.Transfer(churchId, receipt.Id, receipt.ETag, movedReceipt, keeper?.ETag, cancellationToken);
                return "moved";
            }
            catch (ApiException error) when (error.Status is 404 or 409 or 412)
            {
                if (attempt == 2)
                    throw new ApiException(409, "merge_busy", "Check-ins are changing in this session. Wait for check-in activity to finish, then reload and review.");
            }
        }
        throw new InvalidOperationException("Receipt merge did not produce an outcome.");
    }

    private async Task<(Member Keeper, Member Loser)> LoadPair(string churchId, string keepId, string loserId, CancellationToken cancellationToken)
    {
        if (keepId == loserId) throw new ApiException(400, "same_member", "Choose two different members to merge.");
        var keeper = await directory.Get<Member>(churchId, keepId, cancellationToken: cancellationToken);
        var loser = await directory.Get<Member>(churchId, loserId, cancellationToken: cancellationToken);
        if (!keeper.Active || !loser.Active) throw new ApiException(409, "archived", "Both members must be active to merge.");
        return (keeper, loser);
    }

    private async Task<List<Attendance>> Receipts(string churchId, string memberId, bool activeOnly, CancellationToken cancellationToken)
    {
        var receipts = new List<Attendance>();
        string? cursor = null;
        do
        {
            var page = await repositories.Attendance.Search(new Query
            {
                ChurchId = churchId,
                MemberId = memberId,
                ActiveOnly = activeOnly,
                PageSize = 200,
                ContinuationToken = cursor
            }, cancellationToken);
            receipts.AddRange(page.Items);
            cursor = page.ContinuationToken;
        }
        while (cursor is not null);
        return receipts;
    }
}
