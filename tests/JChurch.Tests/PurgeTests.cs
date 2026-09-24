using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public sealed class PurgeTests
{
    private static async Task<(Repositories Repositories, DirectoryService Directory, EventService Events, CheckInService CheckIns, Church Church)> Seed(string suffix)
    {
        var repositories = ServiceTests.Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-23T10:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var events = new EventService(repositories, directory, clock);
        var checkIns = new CheckInService(repositories, directory, clock);
        var church = await directory.Save(new Church { Name = $"Purge {suffix}" }, null);
        var group = await directory.Save(new Group { Name = "Adults" }, church.Id);
        await directory.Save(new Member { FirstName = "Ada", LastName = "Lovelace", MemberType = "adult", ScanCode = $"scan-code-{suffix}", GroupIds = [group.Id] }, church.Id);
        var field = await directory.Save(new CustomField { Name = "Notes", FieldType = "text" }, church.Id);
        var definition = await events.Save(new ChurchEvent { Name = "Service", LocalStart = new DateTime(2026, 9, 24, 10, 0, 0), TimeZone = "UTC", GroupIds = [group.Id] }, church.Id);
        var occurrence = await events.Generate(church.Id, definition.Id);
        await checkIns.CheckIn(church.Id, occurrence!.Id, (await repositories.Members.Search(new Query { ChurchId = church.Id })).Items[0].Id);
        _ = field;
        return (repositories, directory, events, checkIns, church);
    }

    [Fact]
    public async Task PurgeRemovesEveryDocumentForTheChurchButLeavesOthersUntouched()
    {
        var (repositories, directory, _, _, church) = await Seed("a");
        var (otherRepositories, otherDirectory, otherEvents, otherCheckIns, otherChurch) = await Seed("b");
        _ = (otherEvents, otherCheckIns);

        var member = (await repositories.Members.Search(new Query { ChurchId = church.Id })).Items[0];
        Assert.NotNull(await repositories.Members.ResolveScanCode(church.Id, "scan-code-a"));

        var archived = await directory.Get<Church>(church.Id, church.Id);
        await directory.Archive<Church>(church.Id, church.Id, archived.ETag);
        archived = await directory.Get<Church>(church.Id, church.Id);
        await directory.Purge(church.Id, archived.ETag);

        Assert.Null(await repositories.Churches.Get(church.Id, church.Id));
        Assert.Null(await repositories.Groups.Get(church.Id, member.GroupIds[0]));
        Assert.Null(await repositories.Members.Get(church.Id, member.Id));
        Assert.Null(await repositories.Members.ResolveScanCode(church.Id, "scan-code-a"));
        Assert.Empty((await repositories.Fields.Search(new Query { ChurchId = church.Id, ActiveOnly = false })).Items);
        Assert.Empty((await repositories.Events.Search(new Query { ChurchId = church.Id, ActiveOnly = false })).Items);
        Assert.Empty((await repositories.Occurrences.Search(new Query { ChurchId = church.Id, ActiveOnly = false })).Items);
        Assert.Empty((await repositories.Attendance.Search(new Query { ChurchId = church.Id, ActiveOnly = false })).Items);

        // Untouched control church survives the purge of the first church.
        Assert.NotNull(await otherRepositories.Churches.Get(otherChurch.Id, otherChurch.Id));
        Assert.Single((await otherRepositories.Members.Search(new Query { ChurchId = otherChurch.Id })).Items);
        Assert.NotNull(await otherRepositories.Members.ResolveScanCode(otherChurch.Id, "scan-code-b"));
        _ = otherDirectory;
    }

    [Fact]
    public async Task PurgeRequiresTheChurchToAlreadyBeArchived()
    {
        var (_, directory, _, _, church) = await Seed("active");
        var current = await directory.Get<Church>(church.Id, church.Id);
        var error = await Assert.ThrowsAsync<ApiException>(() => directory.Purge(church.Id, current.ETag));
        Assert.Equal(409, error.Status);
        Assert.Equal("not_archived", error.Code);
    }

    [Fact]
    public async Task PurgeRequiresAnExactEtagMatch()
    {
        var (_, directory, _, _, church) = await Seed("stale");
        var current = await directory.Get<Church>(church.Id, church.Id);
        await directory.Archive<Church>(church.Id, church.Id, current.ETag);
        var error = await Assert.ThrowsAsync<ApiException>(() => directory.Purge(church.Id, "\"wrong\""));
        Assert.Equal(412, error.Status);
    }
}
