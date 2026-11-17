using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public sealed class MergeReliabilityTests
{
    private sealed class RepositoryProbe<T>(IRepository<T> inner) : IRepository<T> where T : Document
    {
        public Func<T, Task>? BeforeReplace { get; set; }
        public Func<Task>? BeforeTransfer { get; set; }
        public Func<Task>? BeforeDeduplicate { get; set; }

        public Task<T?> Get(string churchId, string id, string? occurrenceId = null, CancellationToken cancellationToken = default) =>
            inner.Get(churchId, id, occurrenceId, cancellationToken);
        public Task<Creation<T>> Create(T document, CancellationToken cancellationToken = default) => inner.Create(document, cancellationToken);
        public Task<Page<T>> Search(Query query, CancellationToken cancellationToken = default) => inner.Search(query, cancellationToken);
        public async Task<T> Replace(T document, string etag, CancellationToken cancellationToken = default)
        {
            if (BeforeReplace is not null) await BeforeReplace(document);
            return await inner.Replace(document, etag, cancellationToken);
        }
        public async Task<T> Transfer(string churchId, string loserId, string loserEtag, T keeper, string? keeperEtag = null, CancellationToken cancellationToken = default)
        {
            if (BeforeTransfer is not null) await BeforeTransfer();
            return await inner.Transfer(churchId, loserId, loserEtag, keeper, keeperEtag, cancellationToken);
        }
        public async Task Deduplicate(T loser, T keeper, CancellationToken cancellationToken = default)
        {
            if (BeforeDeduplicate is not null) await BeforeDeduplicate();
            await inner.Deduplicate(loser, keeper, cancellationToken);
        }
    }

    private sealed class Fixture
    {
        public Repositories Inner { get; } = ServiceTests.Memory();
        public RepositoryProbe<Member> Members { get; }
        public RepositoryProbe<Attendance> Attendance { get; }
        public DirectoryService Directory { get; }
        public MemberMergeService Merges { get; }
        public CheckInService CheckIns { get; }
        public Member Keeper { get; private set; } = null!;
        public Member Loser { get; private set; } = null!;

        private Fixture()
        {
            Members = new(Inner.Members);
            Attendance = new(Inner.Attendance);
            var repositories = new Repositories(Inner.Churches, Inner.Groups, Members, Inner.Fields, Inner.Events, Inner.Occurrences, Attendance, Inner.Users);
            var clock = new TestClock(DateTimeOffset.Parse("2026-11-16T10:00:00Z"));
            Directory = new(repositories, clock);
            Merges = new(repositories, Directory, clock);
            CheckIns = new(repositories, Directory, clock);
        }

        public static async Task<Fixture> Create()
        {
            var fixture = new Fixture();
            var church = await fixture.Directory.Save(new Church { Name = "Merge reliability" }, null);
            fixture.Keeper = await fixture.Directory.Save(new Member { MemberType = "adult", FirstName = "Ada", LastName = "Test" }, church.Id);
            fixture.Loser = await fixture.Directory.Save(new Member { MemberType = "adult", FirstName = "Ada", LastName = "Test" }, church.Id);
            await fixture.Inner.Events.Create(new ChurchEvent { Id = "event", ChurchId = church.Id });
            await fixture.Inner.Occurrences.Create(new Occurrence { Id = "occurrence", ChurchId = church.Id, EventId = "event" });
            return fixture;
        }

        public Task<MergeResult> Merge(string? etag = null) => Merges.Merge(Keeper.ChurchId, Keeper.Id, Loser.Id, etag ?? Loser.ETag, null, "");
        public Task<Creation<Attendance>> CheckIn(Member member) => CheckIns.CheckIn(member.ChurchId, "occurrence", member.Id);
    }

    [Fact]
    public async Task MergeCanFinishArchivingAfterArchiveFailureWithoutMovingTwice()
    {
        var fixture = await Fixture.Create();
        var original = (await fixture.CheckIn(fixture.Loser)).Item;
        fixture.Members.BeforeReplace = member => !member.Active
            ? throw new ApiException(503, "unavailable", "Synthetic archive failure.")
            : Task.CompletedTask;

        var error = await Assert.ThrowsAsync<ApiException>(() => fixture.Merge());

        Assert.Contains("archive", error.Message);
        Assert.True((await fixture.Directory.Get<Member>(fixture.Loser.ChurchId, fixture.Loser.Id)).Active);
        var moved = (await fixture.Inner.Attendance.Get(fixture.Keeper.ChurchId, CheckInService.ReceiptId("occurrence", fixture.Keeper.Id), "occurrence"))!;
        Assert.Equal(original.CheckedInAt, moved.CheckedInAt);
        fixture.Members.BeforeReplace = null;

        var retry = await fixture.Merge();

        Assert.Equal(0, retry.CheckInsMoved);
        Assert.False((await fixture.Directory.Get<Member>(fixture.Loser.ChurchId, fixture.Loser.Id)).Active);
        var retained = (await fixture.Inner.Attendance.Get(moved.ChurchId, moved.Id, "occurrence"))!;
        Assert.Single(retained.Audit, entry => entry.Action.StartsWith("merged-from"));
        Assert.Equal(1, (await fixture.Inner.Attendance.ActiveCheckInCounts(moved.ChurchId, "event")).Single().CheckedInCount);
    }

    [Fact]
    public async Task MergePreservesConcurrentMemberEditAndRequiresFreshConfirmationToArchive()
    {
        var fixture = await Fixture.Create();
        await fixture.CheckIn(fixture.Loser);
        fixture.Members.BeforeReplace = async member =>
        {
            if (member.Active) return;
            fixture.Members.BeforeReplace = null;
            await fixture.Inner.Members.Replace(fixture.Loser with { Phone = "555-0101" }, fixture.Loser.ETag);
        };

        Assert.Equal(412, (await Assert.ThrowsAsync<ApiException>(() => fixture.Merge())).Status);
        var latest = await fixture.Directory.Get<Member>(fixture.Loser.ChurchId, fixture.Loser.Id);
        Assert.True(latest.Active);
        Assert.Equal("555-0101", latest.Phone);

        await fixture.Merge(latest.ETag);

        var archived = await fixture.Directory.Get<Member>(fixture.Loser.ChurchId, fixture.Loser.Id);
        Assert.False(archived.Active);
        Assert.Equal("555-0101", archived.Phone);
    }

    [Fact]
    public async Task MergeReclassifiesOverlapWhenKeeperIsUndoneDuringDeduplication()
    {
        var fixture = await Fixture.Create();
        await fixture.CheckIn(fixture.Keeper);
        var source = (await fixture.CheckIn(fixture.Loser)).Item;
        fixture.Attendance.BeforeDeduplicate = async () =>
        {
            fixture.Attendance.BeforeDeduplicate = null;
            await fixture.CheckIns.Undo(fixture.Keeper.ChurchId, "occurrence", fixture.Keeper.Id);
        };

        var result = await fixture.Merge();

        Assert.Equal(1, result.CheckInsMoved);
        Assert.Equal(0, result.CheckInsSkipped);
        var kept = (await fixture.CheckIns.Status(fixture.Keeper.ChurchId, "occurrence", fixture.Keeper.Id))!;
        Assert.Equal(source.CheckedInAt, kept.CheckedInAt);
        Assert.Equal(1, (await fixture.Inner.Attendance.ActiveCheckInCounts(fixture.Keeper.ChurchId, "event")).Single().CheckedInCount);
    }

    [Fact]
    public async Task MergeStopsAfterBoundedContentionWithoutArchivingOrLosingReceipts()
    {
        var fixture = await Fixture.Create();
        var source = (await fixture.CheckIn(fixture.Loser)).Item;
        var attempts = 0;
        fixture.Attendance.BeforeTransfer = () =>
        {
            attempts++;
            throw new ApiException(412, "stale_version", "Synthetic contention.");
        };

        var error = await Assert.ThrowsAsync<ApiException>(() => fixture.Merge());

        Assert.Equal("merge_busy", error.Code);
        Assert.Equal(3, attempts);
        Assert.True((await fixture.Inner.Attendance.Get(source.ChurchId, source.Id, "occurrence"))!.Active);
        Assert.True((await fixture.Directory.Get<Member>(fixture.Loser.ChurchId, fixture.Loser.Id)).Active);
        fixture.Attendance.BeforeTransfer = null;
        Assert.Equal(1, (await fixture.Merge()).CheckInsMoved);
    }

    [Fact]
    public async Task MergeDoesNotArchiveWhenNewLoserAttendanceAppearsDuringTransfer()
    {
        var fixture = await Fixture.Create();
        var source = (await fixture.CheckIn(fixture.Loser)).Item;
        fixture.Attendance.BeforeTransfer = async () =>
        {
            fixture.Attendance.BeforeTransfer = null;
            await fixture.Inner.Attendance.Create(source with { Id = $"late_{fixture.Loser.Id}", OccurrenceId = "late", ETag = "" });
        };

        var error = await Assert.ThrowsAsync<ApiException>(() => fixture.Merge());

        Assert.Equal("merge_incomplete", error.Code);
        Assert.True((await fixture.Directory.Get<Member>(fixture.Loser.ChurchId, fixture.Loser.Id)).Active);
        Assert.Equal(1, (await fixture.Merge()).CheckInsMoved);
        Assert.False((await fixture.Directory.Get<Member>(fixture.Loser.ChurchId, fixture.Loser.Id)).Active);
    }

    [Fact]
    public async Task MergeProcessesMoreThanOnePageOfMixedHistoricalAttendance()
    {
        var fixture = await Fixture.Create();
        var timestamp = DateTimeOffset.Parse("2020-01-01T10:00:00Z");
        for (var index = 0; index < 205; index++)
        {
            var occurrence = $"history_{index:D3}";
            var receipt = new Attendance
            {
                Id = CheckInService.ReceiptId(occurrence, fixture.Loser.Id), ChurchId = fixture.Loser.ChurchId,
                OccurrenceId = occurrence, EventId = "event", MemberId = fixture.Loser.Id,
                CheckedInAt = timestamp, GroupIds = ["historical"], InclusiveGroupIds = ["parent", "historical"]
            };
            await fixture.Inner.Attendance.Create(receipt);
            if (index % 2 == 0)
                await fixture.Inner.Attendance.Create(receipt with { Id = CheckInService.ReceiptId(occurrence, fixture.Keeper.Id), MemberId = fixture.Keeper.Id });
        }

        var result = await fixture.Merge();

        Assert.Equal(102, result.CheckInsMoved);
        Assert.Equal(103, result.CheckInsSkipped);
        Assert.False((await fixture.Directory.Get<Member>(fixture.Loser.ChurchId, fixture.Loser.Id)).Active);
        Assert.Empty((await fixture.Inner.Attendance.Search(new Query { ChurchId = fixture.Loser.ChurchId, MemberId = fixture.Loser.Id })).Items);
        Assert.Equal(205, (await fixture.Inner.Attendance.ActiveCheckInCounts(fixture.Keeper.ChurchId, "event")).Sum(row => row.CheckedInCount));
        var moved = (await fixture.Inner.Attendance.Get(fixture.Keeper.ChurchId, CheckInService.ReceiptId("history_001", fixture.Keeper.Id), "history_001"))!;
        Assert.Equal(timestamp, moved.CheckedInAt);
        Assert.Equal(["historical"], moved.GroupIds);
        Assert.Equal(["parent", "historical"], moved.InclusiveGroupIds);
    }
}