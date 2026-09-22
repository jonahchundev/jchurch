using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public sealed class RecoveryTests
{
    private sealed class TimeoutAfterSave(IRepository<Attendance> inner) : IRepository<Attendance>
    {
        private int writes;
        public Task<Attendance?> Get(string churchId, string id, string? occurrenceId = null, CancellationToken cancellationToken = default) => inner.Get(churchId, id, occurrenceId, cancellationToken);
        public async Task<Creation<Attendance>> Create(Attendance document, CancellationToken cancellationToken = default)
        {
            var result = await inner.Create(document, cancellationToken);
            if (Interlocked.Increment(ref writes) == 1) throw new TimeoutException("Synthetic timeout after persistence.");
            return result;
        }
        public Task<Attendance> Replace(Attendance document, string etag, CancellationToken cancellationToken = default) => inner.Replace(document, etag, cancellationToken);
        public Task<Page<Attendance>> Search(Query query, CancellationToken cancellationToken = default) => inner.Search(query, cancellationToken);
    }

    [Fact]
    public async Task TimeoutAfterSaveReturnsExistingReceiptOnRetry()
    {
        var memory = ServiceTests.Memory();
        var repositories = new Repositories(memory.Churches, memory.Groups, memory.Members, memory.Fields, memory.Events, memory.Occurrences, new TimeoutAfterSave(memory.Attendance));
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-20T10:00:00Z"));
        await Seed(repositories, "church", clock.Now);
        var service = new CheckInService(repositories, new DirectoryService(repositories, clock), clock);
        await Assert.ThrowsAsync<TimeoutException>(() => service.CheckIn("church", "occurrence", "member"));
        clock.Now = clock.Now.AddDays(1);
        var retry = await service.CheckIn("church", "occurrence", "member");
        Assert.False(retry.Created);
        Assert.Single((await memory.Attendance.Search(new Query { ChurchId = "church" })).Items);
    }

    [Fact]
    public async Task SimultaneousChurchesRemainIsolated()
    {
        var repositories = ServiceTests.Memory();
        var clock = new TestClock(DateTimeOffset.UtcNow);
        await Seed(repositories, "first", clock.Now);
        await Seed(repositories, "second", clock.Now);
        var service = new CheckInService(repositories, new DirectoryService(repositories, clock), clock);
        var results = await Task.WhenAll(Enumerable.Range(0, 100).Select(index => Task.Run(() => service.CheckIn(index % 2 == 0 ? "first" : "second", "occurrence", "member"))));
        Assert.Equal(2, results.Count(result => result.Created));
        Assert.Single((await repositories.Attendance.Search(new Query { ChurchId = "first" })).Items);
        Assert.Single((await repositories.Attendance.Search(new Query { ChurchId = "second" })).Items);
    }

    [Fact]
    public async Task RegenerationPreservesOverridesAndCancellation()
    {
        var repositories = ServiceTests.Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-20T10:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        var church = await directory.Save(new Church { Name = "Synthetic" }, null);
        var events = new EventService(repositories, directory, clock);
        var definition = await events.Save(new ChurchEvent { Name = "Future", LocalStart = new DateTime(2026, 9, 21, 10, 0, 0), TimeZone = "UTC" }, church.Id);
        Assert.NotNull(await events.Generate(church.Id, definition.Id));
        var occurrence = Assert.Single((await repositories.Occurrences.Search(new Query { ChurchId = church.Id })).Items);
        var updated = await events.Override(church.Id, occurrence.Id, occurrence.StartsAt.AddHours(1), occurrence.EndsAt.AddHours(1), true, occurrence.Archived, occurrence.ETag);
        Assert.Null(await events.Generate(church.Id, definition.Id));
        var retained = await repositories.Occurrences.Get(church.Id, occurrence.Id);
        Assert.Equal(updated, retained);
        clock.Now = updated.StartsAt;
        await Assert.ThrowsAsync<ApiException>(() => events.Override(church.Id, occurrence.Id, clock.Now.AddDays(1), clock.Now.AddDays(1).AddHours(1), false, updated.Archived, updated.ETag));
    }

    [Theory]
    [InlineData("2026-03-08T02:30:00")]
    [InlineData("2026-11-01T01:30:00")]
    public void InitialDstGapOrAmbiguityRequiresExplicitRescheduling(string local)
    {
        var definition = new ChurchEvent { LocalStart = DateTime.Parse(local), TimeZone = "America/New_York" };
        Assert.Throws<ApiException>(() => EventService.Expand(definition, DateTimeOffset.Parse("2026-03-01T00:00:00Z"), DateTimeOffset.Parse("2026-04-01T00:00:00Z")));
    }

    private static async Task Seed(Repositories repositories, string church, DateTimeOffset start)
    {
        await repositories.Churches.Create(new Church { Id = church, ChurchId = church });
        await repositories.Members.Create(new Member { Id = "member", ChurchId = church });
        await repositories.Events.Create(new ChurchEvent { Id = "event", ChurchId = church });
        await repositories.Occurrences.Create(new Occurrence { Id = "occurrence", ChurchId = church, EventId = "event", StartsAt = start, EndsAt = start.AddHours(1) });
    }
}