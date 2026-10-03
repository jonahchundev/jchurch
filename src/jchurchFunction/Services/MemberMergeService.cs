using JChurch.Domain;
using JChurch.Storage;

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
public sealed class MemberMergeService(Repositories repositories, DirectoryService directory, TimeProvider clock)
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

        // Optional per-field keeper update (validated exactly like a normal member save). If it takes the loser's
        // live scan code, release that code from the loser first (archiving alone does not release a ScanCodeLookup).
        if (keeperUpdate is not null)
        {
            if (keeperUpdate.ScanCode is { } code && string.Equals(ScanCodes.Normalize(code), loser.ScanCode, StringComparison.Ordinal))
                await repositories.Members.Replace(loser with { ScanCode = null, ScanCodeFormat = null }, loser.ETag, cancellationToken);
            var updated = keeperUpdate with { Id = keeper.Id, ChurchId = churchId };
            keeper = await directory.Save(updated, churchId, keeper.Id, keeperEtag, cancellationToken);
        }

        // Load the keeper's receipts with inactive ones included: an undone check-in still occupies the
        // deterministic receipt slot ({occurrenceId}_{memberId}), so a naive create would collide with it.
        var keeperReceipts = await Receipts(churchId, keeper.Id, activeOnly: false, cancellationToken);
        var keeperOccurrences = new HashSet<string>(keeperReceipts.Where(receipt => receipt.Active).Select(receipt => receipt.OccurrenceId), StringComparer.Ordinal);
        var staleKeeperReceipts = new Dictionary<string, Attendance>(StringComparer.Ordinal);
        foreach (var receipt in keeperReceipts)
            if (!receipt.Active && receipt.OccurrenceId is not null) staleKeeperReceipts[receipt.OccurrenceId] = receipt;
        var loserReceipts = await Receipts(churchId, loser.Id, activeOnly: true, cancellationToken);
        var moved = 0;
        var skipped = 0;
        foreach (var receipt in loserReceipts)
        {
            if (receipt.OccurrenceId is not { } occurrenceId) continue;
            if (keeperOccurrences.Contains(occurrenceId))
            {
                // True duplicate: same person checked in twice to one occurrence. Keep the keeper's receipt and
                // archive the loser's copy — the occurrence's active count drops by one (real headcount).
                await repositories.Attendance.Replace(receipt with
                {
                    Active = false,
                    Audit = [.. receipt.Audit, new AttendanceAuditEntry { Action = $"merged-to {keeper.Id} (duplicate)", OccurredAt = clock.GetUtcNow() }]
                }, receipt.ETag, cancellationToken);
                skipped++;
                continue;
            }
            var moved1 = receipt with
            {
                Id = CheckInService.ReceiptId(occurrenceId, keeper.Id),
                MemberId = keeper.Id,
                ETag = "",
                Audit = [.. receipt.Audit, new AttendanceAuditEntry { Action = $"merged-from {loser.Id}", OccurredAt = clock.GetUtcNow() }]
            };
            // Replace the keeper's stale (undone) receipt in place when one occupies the slot.
            staleKeeperReceipts.TryGetValue(occurrenceId, out var stale);
            await repositories.Attendance.Transfer(churchId, receipt.Id, receipt.ETag, moved1, stale?.ETag, cancellationToken);
            keeperOccurrences.Add(occurrenceId);
            moved++;
        }

        await directory.Archive<Member>(churchId, loser.Id, loserEtag, cancellationToken);
        return new MergeResult(keeper.Id, loser.Id, moved, skipped);
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
