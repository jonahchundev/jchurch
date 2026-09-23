using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public sealed class TestClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;
    public override DateTimeOffset GetUtcNow() => Now;
}

public sealed class ServiceTests
{
    [Fact]
    public async Task EventGroupsInheritToOccurrencesAndCanBeClearedPerOccurrence()
    {
        var repositories = Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-23T08:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var events = new EventService(repositories, directory, clock);
        var church = await directory.Save(new Church { Name = "Groups" }, null);
        var group = await directory.Save(new Group { Name = "Children" }, church.Id);
        var other = await directory.Save(new Group { Name = "Adults" }, church.Id);
        var definition = await events.Save(new ChurchEvent { Name = "Service", LocalStart = new DateTime(2026, 9, 24, 10, 0, 0), TimeZone = "UTC", GroupIds = [group.Id] }, church.Id);
        var occurrence = await events.Generate(church.Id, definition.Id);
        Assert.Equal([group.Id], occurrence!.GroupIds);
        var cleared = await events.Override(church.Id, occurrence.Id, occurrence.StartsAt, occurrence.EndsAt, false, false, occurrence.ETag, groupIds: []);
        Assert.Empty(cleared.GroupIds);
        var reassigned = await events.Override(church.Id, occurrence.Id, occurrence.StartsAt, occurrence.EndsAt, false, false, cleared.ETag, groupIds: [other.Id]);
        Assert.Equal([other.Id], reassigned.GroupIds);
    }

    [Fact]
    public async Task CurrentOccurrenceCanChangeGroupsWithoutChangingItsSchedule()
    {
        var repositories = Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-23T10:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var events = new EventService(repositories, directory, clock);
        var church = await directory.Save(new Church { Name = "Current session groups" }, null);
        var group = await directory.Save(new Group { Name = "Adults" }, church.Id);
        var occurrence = (await repositories.Occurrences.Create(new Occurrence
        {
            Id = "occurrence", ChurchId = church.Id, EventId = "event",
            StartsAt = clock.Now.AddMinutes(-15), EndsAt = clock.Now.AddMinutes(45)
        })).Item;

        var updated = await events.Override(
            church.Id, occurrence.Id, occurrence.StartsAt, occurrence.EndsAt,
            occurrence.Cancelled, occurrence.Archived, occurrence.ETag, groupIds: [group.Id]);

        Assert.Equal([group.Id], updated.GroupIds);
        Assert.Equal(occurrence.StartsAt, updated.StartsAt);
        Assert.Equal(occurrence.EndsAt, updated.EndsAt);
    }

    [Fact]
    public async Task MemberGroupQueryUsesUnionMatching()
    {
        var repositories = Memory();
        var directory = new DirectoryService(repositories, TimeProvider.System);
        var church = await directory.Save(new Church { Name = "Query" }, null);
        var first = await directory.Save(new Group { Name = "First" }, church.Id);
        var second = await directory.Save(new Group { Name = "Second" }, church.Id);
        await directory.Save(new Member { MemberType = "adult", FirstName = "One", LastName = "Member", GroupIds = [first.Id] }, church.Id);
        await directory.Save(new Member { MemberType = "adult", FirstName = "Two", LastName = "Member", GroupIds = [second.Id] }, church.Id);
        await directory.Save(new Member { MemberType = "adult", FirstName = "Three", LastName = "Member" }, church.Id);
        var page = await repositories.Members.Search(new Query { ChurchId = church.Id, GroupIds = [first.Id, second.Id] });
        Assert.Equal(2, page.Items.Count);
    }

    [Fact]
    public async Task ChurchScanFormatDefaultsToQrAndRejectsUnsupportedValues()
    {
        var repositories = Memory();
        var service = new DirectoryService(repositories, TimeProvider.System);
        var defaultChurch = await service.Save(new Church { Name = "Default" }, null);
        Assert.Equal("qr", defaultChurch.ScanCodeFormat);
        var barcodeChurch = await service.Save(new Church { Name = "Barcode", ScanCodeFormat = "code128" }, null);
        Assert.Equal("code128", barcodeChurch.ScanCodeFormat);
        var error = await Assert.ThrowsAsync<ApiException>(() => service.Save(new Church { Name = "Invalid", ScanCodeFormat = "pdf" }, null));
        Assert.Contains("scanCodeFormat", error.Message);
    }

    [Fact]
    public async Task GenerateCreatesMissingPastOneTimeOccurrenceWithinWindow()
    {
        var repositories = Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-23T12:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var events = new EventService(repositories, directory, clock);
        var church = await directory.Save(new Church { Name = "Occurrence" }, null);
        var definition = await events.Save(new ChurchEvent
        {
            Name = "Past one-time",
            LocalStart = new DateTime(2026, 9, 22, 10, 0, 0),
            TimeZone = "UTC",
            DurationMinutes = 60
        }, church.Id);
        var generated = await events.Generate(church.Id, definition.Id);
        Assert.NotNull(generated);
        Assert.Equal(DateTimeOffset.Parse("2026-09-22T10:00:00Z"), generated!.StartsAt);
        Assert.Null(await events.Generate(church.Id, definition.Id));
    }

    [Fact]
    public async Task GenerateCreatesMissingOneTimeOccurrenceEarlierToday()
    {
        var repositories = Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-23T12:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var events = new EventService(repositories, directory, clock);
        var church = await directory.Save(new Church { Name = "Today" }, null);
        var definition = await events.Save(new ChurchEvent
        {
            Name = "Today one-time",
            LocalStart = new DateTime(2026, 9, 23, 10, 0, 0),
            TimeZone = "UTC",
            DurationMinutes = 60
        }, church.Id);
        var occurrence = await events.Generate(church.Id, definition.Id);
        Assert.NotNull(occurrence);
        Assert.Equal(DateTimeOffset.Parse("2026-09-23T10:00:00Z"), occurrence!.StartsAt);
    }

    [Fact]
    public async Task ChildGuardiansRequireContactDetailsAndLimitOtherRelationship()
    {
        var repositories = Memory();
        var service = new DirectoryService(repositories, TimeProvider.System);
        var church = await service.Save(new Church { Name = "Guardian validation" }, null);
        var guardian = new Guardian
        {
            FirstName = "Maria",
            LastName = "Test",
            Relationship = "Others",
            OtherRelationship = new string('x', 50),
            Phone = "555-0100",
            Email = "maria@example.com"
        };
        var child = await service.Save(new Member { MemberType = "child", FirstName = "Child", LastName = "Test", Guardian1 = guardian }, church.Id);
        Assert.Equal(guardian.OtherRelationship, child.Guardian1!.OtherRelationship);

        var missingPhone = guardian with { Phone = "" };
        var phoneError = await Assert.ThrowsAsync<ApiException>(() => service.Save(new Member { MemberType = "child", FirstName = "Child", LastName = "Phone", Guardian1 = missingPhone }, church.Id));
        Assert.Contains("phone is required", phoneError.Message);

        var longOther = guardian with { OtherRelationship = new string('x', 51) };
        var relationshipError = await Assert.ThrowsAsync<ApiException>(() => service.Save(new Member { MemberType = "child", FirstName = "Child", LastName = "Relationship", Guardian1 = longOther }, church.Id));
        Assert.Contains("at most 50", relationshipError.Message);
    }

    [Fact]
    public async Task ScanCodesReplaceAtomicallyAndRejectConcurrentOwners()
    {
        var repository = new InMemoryRepository<Member>();
        var member = (await repository.Create(new Member { Id = "member", ChurchId = "church", ScanCode = " 0000-old ", ScanCodeFormat = "qr" })).Item;
        Assert.Equal(member.Id, (await repository.ResolveScanCode("church", "0000-OLD"))!.Id);
        var updated = await repository.Replace(member with { ScanCode = "0000-new" }, member.ETag);
        Assert.Null(await repository.ResolveScanCode("church", "0000-old"));
        Assert.Equal(member.Id, (await repository.ResolveScanCode("church", "0000-new"))!.Id);
        Assert.Null(await repository.ResolveScanCode("other", "0000-new"));
        Assert.Equal(412, (await Assert.ThrowsAsync<ApiException>(() => repository.Replace(member with { ScanCode = "stale-code" }, member.ETag))).Status);
        Assert.Null(await repository.ResolveScanCode("church", "stale-code"));
        var outcomes = await Task.WhenAll(Enumerable.Range(0, 20).Select(index => Task.Run(async () =>
        {
            try { await repository.Create(new Member { Id = $"member_{index}", ChurchId = "church", ScanCode = "shared-code" }); return true; }
            catch (ApiException error) when (error.Code == "scan_code_in_use") { return false; }
        })));
        Assert.Single(outcomes, success => success);
        await repository.Replace(updated with { Active = false }, updated.ETag);
        Assert.Null(await repository.ResolveScanCode("church", "0000-new"));
        Assert.Equal("scan_code_in_use", (await Assert.ThrowsAsync<ApiException>(() => repository.Create(new Member { Id = "another", ChurchId = "church", ScanCode = "0000-new" }))).Code);
    }

    internal static Repositories Memory() => new(new InMemoryRepository<Church>(), new InMemoryRepository<Group>(), new InMemoryRepository<Member>(),
        new InMemoryRepository<CustomField>(), new InMemoryRepository<ChurchEvent>(), new InMemoryRepository<Occurrence>(), new InMemoryRepository<Attendance>());

    [Fact]
    public async Task CheckInIsAtomicAndPreservesHistoricalGroups()
    {
        var repositories = Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-20T10:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var service = new CheckInService(repositories, directory, clock);
        var church = await directory.Save(new Church { Name = "Synthetic Church" }, null);
        var group = await directory.Save(new Group { Name = "Adults" }, church.Id);
        var subgroup = await directory.Save(new Group { Name = "Class", ParentGroupId = group.Id }, church.Id);
        var member = await directory.Save(new Member { MemberType = "adult", FirstName = "Ada", LastName = "Test", GroupIds = [group.Id, subgroup.Id] }, church.Id);
        var definition = (await repositories.Events.Create(new ChurchEvent { Id = "event", ChurchId = church.Id })).Item;
        await repositories.Occurrences.Create(new Occurrence { Id = "occurrence", ChurchId = church.Id, EventId = definition.Id, StartsAt = clock.Now, EndsAt = clock.Now.AddHours(1) });
        var results = await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Run(() => service.CheckIn(church.Id, "occurrence", member.Id))));
        Assert.Single(results, result => result.Created);
        await directory.Save(member with { GroupIds = [] }, church.Id, member.Id, member.ETag);
        var report = await repositories.Attendance.Search(new Query { ChurchId = church.Id, GroupId = group.Id, IncludeSubgroups = true });
        Assert.Single(report.Items);
        Assert.Equal(2, report.Items[0].GroupIds.Length);
        clock.Now = clock.Now.AddDays(1);
        Assert.False((await service.CheckIn(church.Id, "occurrence", member.Id)).Created);
    }

    [Fact]
    public async Task UndoRetainsAuditAndAllowsAnotherCheckIn()
    {
        var repositories = Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-20T10:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var service = new CheckInService(repositories, directory, clock);
        await repositories.Churches.Create(new Church { Id = "church", ChurchId = "church" });
        await repositories.Members.Create(new Member { Id = "member", ChurchId = "church", FirstName = "Ada", LastName = "Test" });
        await repositories.Events.Create(new ChurchEvent { Id = "event", ChurchId = "church" });
        await repositories.Occurrences.Create(new Occurrence { Id = "occurrence", ChurchId = "church", EventId = "event", StartsAt = clock.Now, EndsAt = clock.Now.AddHours(1) });

        var checkedIn = await service.CheckIn("church", "occurrence", "member");
        Assert.True(checkedIn.Created);
        Assert.Equal(["checked_in"], checkedIn.Item.Audit.Select(entry => entry.Action));

        clock.Now = clock.Now.AddMinutes(1);
        var undone = await service.Undo("church", "occurrence", "member");
        Assert.True(undone.Created);
        Assert.False(undone.Item.Active);
        Assert.Equal(["checked_in", "undone"], undone.Item.Audit.Select(entry => entry.Action));
        Assert.Null(await service.Status("church", "occurrence", "member"));
        Assert.Empty((await repositories.Attendance.Search(new Query { ChurchId = "church" })).Items);
        Assert.Single((await repositories.Attendance.Search(new Query { ChurchId = "church", ActiveOnly = false })).Items);
        Assert.False((await service.Undo("church", "occurrence", "member")).Created);

        clock.Now = clock.Now.AddMinutes(1);
        var checkedInAgain = await service.CheckIn("church", "occurrence", "member");
        Assert.True(checkedInAgain.Created);
        Assert.True(checkedInAgain.Item.Active);
        Assert.Equal(clock.Now, checkedInAgain.Item.CheckedInAt);
        Assert.Equal(["checked_in", "undone", "checked_in"], checkedInAgain.Item.Audit.Select(entry => entry.Action));
    }

    [Theory]
    [InlineData("short")]
    [InlineData("0000-\u017fcan")]
    [InlineData("0000-\u00dfcan")]
    [InlineData("https://invalid")]
    [InlineData("embedded space")]
    [InlineData("code\ninside")]
    public void ScanCodesRejectInvalidValues(string code) => Assert.Throws<ApiException>(() => ScanCodes.Normalize(code));

    [Fact]
    public async Task ScanCodesPreserveLegacyEditsAndAttendanceAcrossReissue()
    {
        var repositories = Memory();
        var clock = new TestClock(DateTimeOffset.UtcNow);
        var directory = new DirectoryService(repositories, clock);
        var church = await directory.Save(new Church { Name = "Synthetic" }, null);
        var member = await directory.Save(new Member { MemberType = "adult", FirstName = "Scan", LastName = "Test", ScanCode = "0000-old", ScanCodeFormat = "code128" }, church.Id);
        member = await directory.Save(new Member { MemberType = "adult", FirstName = "Legacy", LastName = "Edit" }, church.Id, member.Id, member.ETag);
        Assert.Equal("0000-OLD", member.ScanCode);
        Assert.Equal("code128", member.ScanCodeFormat);
        await repositories.Events.Create(new ChurchEvent { Id = "event", ChurchId = church.Id });
        var occurrence = (await repositories.Occurrences.Create(new Occurrence { Id = "occurrence", ChurchId = church.Id, EventId = "event", StartsAt = clock.Now.AddDays(2), EndsAt = clock.Now.AddDays(2).AddHours(1) })).Item;
        var service = new CheckInService(repositories, directory, clock);
        var resolved = await service.ResolveScan(church.Id, "0000-old");
        Assert.True((await service.CheckIn(church.Id, occurrence.Id, resolved.Id)).Created);
        member = await directory.Save(member with { ScanCode = "0000-new" }, church.Id, member.Id, member.ETag);
        Assert.Equal("scan_code_not_found", (await Assert.ThrowsAsync<ApiException>(() => service.ResolveScan(church.Id, "0000-old"))).Code);
        Assert.False((await service.CheckIn(church.Id, occurrence.Id, (await service.ResolveScan(church.Id, "0000-new")).Id)).Created);
        var other = await directory.Save(new Member { MemberType = "adult", FirstName = "Other", LastName = "Test", ScanCode = "other-code" }, church.Id);
        await repositories.Occurrences.Replace(occurrence with { Cancelled = true }, occurrence.ETag);
        Assert.Equal("check_in_closed", (await Assert.ThrowsAsync<ApiException>(() => service.CheckIn(church.Id, occurrence.Id, other.Id))).Code);
        member = await directory.Save(member with { ScanCode = null, ScanCodeSpecified = true }, church.Id, member.Id, member.ETag);
        Assert.Null(member.ScanCode);
        Assert.Null(await repositories.Members.ResolveScanCode(church.Id, "0000-new"));
    }

    [Theory]
    [InlineData(-1, false, false)]
    [InlineData(0, false, false)]
    [InlineData(3599, false, false)]
    [InlineData(3600, false, false)]
    [InlineData(86400, false, false)]
    [InlineData(-1, true, false)]
    [InlineData(0, true, false)]
    [InlineData(3600, true, false)]
    [InlineData(3600, false, true)]
    public async Task CheckInIgnoresOccurrenceTimesButRejectsClosedSessions(int seconds, bool cancelled, bool archived)
    {
        var repositories = Memory();
        var start = DateTimeOffset.Parse("2026-09-20T10:00:00Z");
        var clock = new TestClock(start.AddSeconds(seconds));
        var directory = new DirectoryService(repositories, clock);
        await repositories.Churches.Create(new Church { Id = "church", ChurchId = "church" });
        await repositories.Members.Create(new Member { Id = "member", ChurchId = "church" });
        await repositories.Events.Create(new ChurchEvent { Id = "event", ChurchId = "church" });
        await repositories.Occurrences.Create(new Occurrence { Id = "occurrence", ChurchId = "church", EventId = "event", StartsAt = start, EndsAt = start.AddHours(1), Cancelled = cancelled, Archived = archived });
        var service = new CheckInService(repositories, directory, clock);
        if (!cancelled && !archived)
        {
            var result = await service.CheckIn("church", "occurrence", "member");
            Assert.True(result.Created);
            Assert.Equal(clock.Now, result.Item.CheckedInAt);
        }
        else
        {
            var error = await Assert.ThrowsAsync<ApiException>(() => service.CheckIn("church", "occurrence", "member"));
            Assert.Equal(409, error.Status);
            Assert.Equal("check_in_closed", error.Code);
        }
    }

    [Fact]
    public async Task CompletedOccurrencesCanBeArchivedAndRestored()
    {
        var repositories = Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-20T12:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var events = new EventService(repositories, directory, clock);
        await repositories.Churches.Create(new Church { Id = "church", ChurchId = "church" });
        await repositories.Events.Create(new ChurchEvent { Id = "event", ChurchId = "church" });
        var completed = (await repositories.Occurrences.Create(new Occurrence
        {
            Id = "completed", ChurchId = "church", EventId = "event", StartsAt = clock.Now.AddHours(-2), EndsAt = clock.Now.AddHours(-1)
        })).Item;
        var future = (await repositories.Occurrences.Create(new Occurrence
        {
            Id = "future", ChurchId = "church", EventId = "event", StartsAt = clock.Now.AddHours(1), EndsAt = clock.Now.AddHours(2)
        })).Item;

        var archived = await events.Override("church", completed.Id, completed.StartsAt, completed.EndsAt, completed.Cancelled, true, completed.ETag);
        Assert.True(archived.Archived);
        var restored = await events.Override("church", archived.Id, archived.StartsAt, archived.EndsAt, archived.Cancelled, false, archived.ETag);
        Assert.False(restored.Archived);
        var error = await Assert.ThrowsAsync<ApiException>(() => events.Override("church", future.Id, future.StartsAt, future.EndsAt, future.Cancelled, true, future.ETag));
        Assert.Equal(400, error.Status);
        Assert.Equal("Only completed occurrences can be archived or restored.", error.Message);
    }

    [Fact]
    public async Task DirectoryRejectsCrossChurchGroupsAndDeepHierarchy()
    {
        var repositories = Memory();
        var service = new DirectoryService(repositories, TimeProvider.System);
        var first = await service.Save(new Church { Name = "First" }, null);
        var second = await service.Save(new Church { Name = "Second" }, null);
        var parent = await service.Save(new Group { Name = "Parent" }, first.Id);
        var child = await service.Save(new Group { Name = "Child", ParentGroupId = parent.Id }, first.Id);
        await Assert.ThrowsAsync<ApiException>(() => service.Save(new Group { Name = "Too deep", ParentGroupId = child.Id }, first.Id));
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => service.Save(new Member { MemberType = "adult", FirstName = "Ada", LastName = "Test", GroupIds = [parent.Id] }, second.Id))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<ApiException>(() => service.Archive<Group>(first.Id, parent.Id, parent.ETag))).Status);
    }

    [Fact]
    public async Task GroupLifecyclePreservesMembershipsAndRejectsInvalidWrites()
    {
        var repositories = Memory();
        var service = new DirectoryService(repositories, TimeProvider.System);
        var church = await service.Save(new Church { Name = "Group lifecycle" }, null);
        var other = await service.Save(new Church { Name = "Other" }, null);
        var parent = await service.Save(new Group { Name = " Parent " }, church.Id);
        var child = await service.Save(new Group { Name = " Child ", ParentGroupId = parent.Id }, church.Id);
        Assert.Equal("Parent", parent.Name);
        Assert.Equal("Child", child.Name);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => service.Save(new Group { Name = "Foreign", ParentGroupId = parent.Id }, other.Id))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => service.Get<Group>(other.Id, child.Id))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<ApiException>(() => service.Archive<Group>(other.Id, child.Id, child.ETag))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => service.Save(new Group { Name = "Self", ParentGroupId = "self" }, church.Id, "self"))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => service.Save(parent with { ParentGroupId = child.Id }, church.Id, parent.Id, parent.ETag))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<ApiException>(() => service.Save(child with { ParentGroupId = null }, church.Id, child.Id, child.ETag))).Status);
        var renamed = await service.Save(child with { Name = "Renamed" }, church.Id, child.Id, child.ETag);
        Assert.Equal(child.ParentGroupId, renamed.ParentGroupId);
        Assert.Equal(412, (await Assert.ThrowsAsync<ApiException>(() => service.Save(child, church.Id, child.Id, child.ETag))).Status);
        Assert.Equal(412, (await Assert.ThrowsAsync<ApiException>(() => service.Archive<Group>(church.Id, child.Id, child.ETag))).Status);
        var member = await service.Save(new Member { MemberType = "adult", FirstName = "Group", LastName = "Member", GroupIds = [parent.Id, child.Id] }, church.Id);
        Assert.Equal("has_subgroups", (await Assert.ThrowsAsync<ApiException>(() => service.Archive<Group>(church.Id, parent.Id, parent.ETag))).Code);
        await service.Archive<Group>(church.Id, child.Id, renamed.ETag);
        Assert.Equal(member.GroupIds, (await service.Get<Member>(church.Id, member.Id)).GroupIds);
        Assert.Equal("archived", (await Assert.ThrowsAsync<ApiException>(() => service.Save(new Member { MemberType = "adult", FirstName = "New", LastName = "Member", GroupIds = [child.Id] }, church.Id))).Code);
        member = await service.Save(member with { GroupIds = [parent.Id] }, church.Id, member.Id, member.ETag);
        Assert.Equal(new[] { parent.Id }, member.GroupIds);
        await service.Archive<Group>(church.Id, parent.Id, parent.ETag);
        Assert.Empty((await repositories.Groups.Search(new Query { ChurchId = church.Id })).Items);
        Assert.Equal(2, (await repositories.Groups.Search(new Query { ChurchId = church.Id, ActiveOnly = false })).Items.Count);
        Assert.Equal("archived", (await Assert.ThrowsAsync<ApiException>(() => service.Save(new Group { Name = "New", ParentGroupId = parent.Id }, church.Id))).Code);
    }

    [Fact]
    public void WeeklyRecurrenceKeepsWallClockTimeAcrossDst()
    {
        var definition = new ChurchEvent
        {
            Id = "event", ChurchId = "church", LocalStart = new DateTime(2026, 3, 1, 9, 0, 0),
            TimeZone = "America/New_York", RecurrenceRule = "FREQ=WEEKLY;COUNT=3", DurationMinutes = 60
        };
        var results = EventService.Expand(definition, DateTimeOffset.Parse("2026-03-01T00:00:00Z"), DateTimeOffset.Parse("2026-03-20T00:00:00Z"));
        Assert.Equal(3, results.Count);
        Assert.Equal(14, results[0].StartsAt.Hour);
        Assert.Equal(13, results[1].StartsAt.Hour);
        Assert.Equal(results.Select(item => item.Id), EventService.Expand(definition, DateTimeOffset.Parse("2026-03-01T00:00:00Z"), DateTimeOffset.Parse("2026-03-20T00:00:00Z")).Select(item => item.Id));
    }
}