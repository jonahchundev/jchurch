using JChurch.Domain;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

internal static class RepositoryContract
{
    public static async Task Run(IRepository<Member> members, IRepository<Attendance> attendance, string? churchId = null, string? otherChurchId = null)
    {
        var church = churchId ?? $"contract_{Guid.NewGuid():N}";
        var otherChurch = otherChurchId ?? $"contract_{Guid.NewGuid():N}";
        // Names sort opposite of ids, proving Search() orders by name and not by id.
        var forgedTimestamp = DateTimeOffset.Parse("2000-01-01T00:00:00Z");
        var original = (await members.Create(new Member { Id = "member_a", ChurchId = church, SearchText = "Ada Test", FirstName = "Zoe", LastName = "Zephyr", GroupIds = ["group"], CreatedOn = forgedTimestamp, UpdatedOn = forgedTimestamp })).Item;
        Assert.NotNull(original.CreatedOn);
        Assert.NotEqual(forgedTimestamp, original.CreatedOn);
        Assert.Equal(original.CreatedOn, original.UpdatedOn);
        await members.Create(new Member { Id = "member_b", ChurchId = church, SearchText = "Ada Test", FirstName = "Amy", LastName = "Aaron", GroupIds = ["group"] });
        await members.Create(new Member { Id = "member_c", ChurchId = church, SearchText = "Other", GroupIds = ["other"] });
        Assert.Null(await members.Get(otherChurch, original.Id));
        var updated = await members.Replace(original with { FirstName = "Updated" }, original.ETag);
        Assert.NotEqual(original.ETag, updated.ETag);
        Assert.Equal(original.CreatedOn, updated.CreatedOn);
        Assert.True(updated.UpdatedOn >= original.UpdatedOn);
        Assert.Equal(412, (await Assert.ThrowsAsync<ApiException>(() => members.Replace(original, original.ETag))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => members.Replace(original with { Id = "missing" }, original.ETag))).Status);
        var query = new Query { ChurchId = church, Search = "ADA", GroupId = "group", PageSize = 1 };
        var ids = new List<string>();
        string? token = null;
        do
        {
            var page = await members.Search(query with { ContinuationToken = token });
            Assert.True(page.Items.Count <= 1);
            ids.AddRange(page.Items.Select(item => item.Id));
            token = page.ContinuationToken;
            if (token is not null)
                Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => members.Search(query with { ChurchId = otherChurch, ContinuationToken = token }))).Status);
        } while (token is not null);
        Assert.Equal(new[] { "member_b", "member_a" }, ids);
        // GroupIds (plural, union) must filter correctly even when GroupId (singular) is not set.
        var groupIdsOnly = await members.Search(new Query { ChurchId = church, GroupIds = ["group"] });
        Assert.Equal(new HashSet<string> { "member_a", "member_b" }, groupIdsOnly.Items.Select(item => item.Id).ToHashSet());
        updated = await members.Replace(updated with { ScanCode = "contract-old", ScanCodeFormat = "qr" }, updated.ETag);
        Assert.Equal(updated.Id, (await members.ResolveScanCode(church, "CONTRACT-old"))!.Id);
        Assert.Null(await members.ResolveScanCode(otherChurch, "CONTRACT-old"));
        var competing = (await members.Get(church, "member_b"))!;
        Assert.Equal("scan_code_in_use", (await Assert.ThrowsAsync<ApiException>(() => members.Replace(competing with { ScanCode = "contract-old" }, competing.ETag))).Code);
        updated = await members.Replace(updated with { ScanCode = "contract-new" }, updated.ETag);
        Assert.Null(await members.ResolveScanCode(church, "contract-old"));
        Assert.Equal(updated.Id, (await members.ResolveScanCode(church, "contract-new"))!.Id);
        Assert.Null((await members.Get(church, "member_b"))!.ScanCode);
        await members.Replace(updated with { Active = false }, updated.ETag);
        Assert.Null(await members.ResolveScanCode(church, "contract-new"));
        Assert.Equal("scan_code_in_use", (await Assert.ThrowsAsync<ApiException>(() => members.Replace(competing with { ScanCode = "contract-new" }, competing.ETag))).Code);
        Assert.False((await members.Get(church, original.Id))!.Active);
        var receipt = new Attendance
        {
            Id = "occurrence_member_a", ChurchId = church, OccurrenceId = "occurrence", EventId = "event", MemberId = "member_a",
            CheckedInAt = DateTimeOffset.Parse("2026-09-20T10:00:00Z"), GroupIds = ["subgroup"], InclusiveGroupIds = ["group", "subgroup"]
        };
        var results = await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Run(() => attendance.Create(receipt))));
        Assert.Single(results, result => result.Created);
        Assert.Single(results.Select(result => result.Item.ETag).Distinct());
        Assert.NotNull(results[0].Item.CreatedOn);
        Assert.Equal(results[0].Item.CreatedOn, results[0].Item.UpdatedOn);
        Assert.Null(await attendance.Get(otherChurch, receipt.Id, receipt.OccurrenceId));
        Assert.True((await attendance.Create(receipt with { ChurchId = otherChurch })).Created);
        var report = new Query
        {
            ChurchId = church, OccurrenceId = "occurrence", EventId = "event", MemberId = "member_a", GroupId = "group", IncludeSubgroups = true,
            From = receipt.CheckedInAt, To = receipt.CheckedInAt.AddSeconds(1)
        };
        var receipts = new List<Attendance>();
        do
        {
            var page = await attendance.Search(report);
            receipts.AddRange(page.Items);
            report = report with { ContinuationToken = page.ContinuationToken };
        } while (report.ContinuationToken is not null);
        Assert.Single(receipts);
        await attendance.Create(receipt with { Id = "occurrence_member_b", MemberId = "member_b" });
        var inactive = (await attendance.Get(church, receipt.Id, receipt.OccurrenceId))!;
        var archived = await attendance.Replace(inactive with { Active = false }, inactive.ETag);
        Assert.Equal(inactive.CreatedOn, archived.CreatedOn);
        Assert.True(archived.UpdatedOn >= inactive.UpdatedOn);
        var counts = await attendance.ActiveCheckInCounts(church, "event");
        Assert.Equal([new OccurrenceCheckInCount("occurrence", 1)], counts);
    }
}