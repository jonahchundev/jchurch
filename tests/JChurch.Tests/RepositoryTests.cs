using JChurch.Domain;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public class RepositoryTests
{
    [Fact]
    public async Task AuditTimestampsAreServerManagedAndCreationTimeIsImmutable()
    {
        var firstInstant = DateTimeOffset.Parse("2026-09-26T10:00:00Z");
        var clock = new TestClock(firstInstant);
        var repository = new InMemoryRepository<Member>(clock);
        var forgedInstant = firstInstant.AddYears(-10);
        var created = (await repository.Create(new Member
        {
            Id = "member", ChurchId = "church", CreatedOn = forgedInstant, UpdatedOn = forgedInstant
        })).Item;

        Assert.Equal(firstInstant, created.CreatedOn);
        Assert.Equal(firstInstant, created.UpdatedOn);
        var duplicate = await repository.Create(new Member { Id = created.Id, ChurchId = created.ChurchId });
        Assert.False(duplicate.Created);
        Assert.Equal(created.CreatedOn, duplicate.Item.CreatedOn);
        Assert.Equal(created.UpdatedOn, duplicate.Item.UpdatedOn);

        var secondInstant = firstInstant.AddMinutes(5);
        clock.Now = secondInstant;
        var updated = await repository.Replace(created with { CreatedOn = forgedInstant, UpdatedOn = forgedInstant }, created.ETag);
        Assert.Equal(firstInstant, updated.CreatedOn);
        Assert.Equal(secondInstant, updated.UpdatedOn);
    }

    [Fact]
    public async Task ConcurrentDuplicatesCreateOneReceipt()
    {
        var repository = new InMemoryRepository<Attendance>();
        var receipt = new Attendance { Id = "member", ChurchId = "church", OccurrenceId = "occurrence", MemberId = "member" };
        var results = await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Run(() => repository.Create(receipt))));
        Assert.Single(results, result => result.Created);
        Assert.Single(results.Select(result => result.Item.ETag).Distinct());
        Assert.Single((await repository.Search(new Query { ChurchId = "church" })).Items);
    }

    [Fact]
    public async Task IsolationConcurrencyAndDefensiveCopies()
    {
        var repository = new InMemoryRepository<Member>();
        var original = (await repository.Create(new Member { Id = "member", ChurchId = "first", FirstName = "Ada", GroupIds = ["group"] })).Item;
        Assert.Null(await repository.Get("second", "member"));
        original.GroupIds[0] = "mutated";
        Assert.Equal("group", (await repository.Get("first", "member"))!.GroupIds[0]);
        var updated = await repository.Replace(original with { FirstName = "Grace" }, original.ETag);
        Assert.NotEqual(original.ETag, updated.ETag);
        var error = await Assert.ThrowsAsync<ApiException>(() => repository.Replace(original, original.ETag));
        Assert.Equal(412, error.Status);
    }

    [Fact]
    public async Task PaginationAndFiltersStayBoundToQuery()
    {
        var repository = new InMemoryRepository<Member>();
        foreach (var id in new[] { "a", "b", "c" })
            await repository.Create(new Member { Id = id, ChurchId = "church", SearchText = "Ada", GroupIds = ["group"] });
        var query = new Query { ChurchId = "church", Search = "ADA", GroupId = "group", PageSize = 2 };
        var first = await repository.Search(query);
        Assert.Equal(2, first.Items.Count);
        var second = await repository.Search(query with { ContinuationToken = first.ContinuationToken });
        Assert.Single(second.Items);
        Assert.Null(second.ContinuationToken);
        await Assert.ThrowsAsync<ApiException>(() => repository.Search(query with { ChurchId = "other", ContinuationToken = first.ContinuationToken }));
    }

    [Fact]
    public async Task MembersPaginateInAscendingNameOrder()
    {
        var repository = new InMemoryRepository<Member>();
        var names = new[] { "Zack Jones", "Aaron Smith", "Mary Smith", "Amy Aaron", "Bob Young" };
        foreach (var (name, index) in names.Select((name, index) => (name, index)))
        {
            var parts = name.Split(' ');
            await repository.Create(new Member { Id = $"member_{index}", ChurchId = "church", FirstName = parts[0], LastName = parts[1] });
        }
        var query = new Query { ChurchId = "church", PageSize = 2 };
        var seen = new List<string>();
        string? token = null;
        do
        {
            var page = await repository.Search(query with { ContinuationToken = token });
            seen.AddRange(page.Items.Select(item => $"{item.LastName} {item.FirstName}"));
            token = page.ContinuationToken;
        } while (token is not null);
        Assert.Equal(names.Select(name => { var p = name.Split(' '); return $"{p[1]} {p[0]}"; }).OrderBy(name => name, StringComparer.Ordinal), seen);
    }

    [Fact]
    public async Task MembersSortByCreatedOnThenSelectedNameDirectionAcrossPages()
    {
        var clock = new TestClock(DateTimeOffset.Parse("2026-09-20T10:00:00Z"));
        var repository = new InMemoryRepository<Member>(clock);
        async Task Add(string id, string firstName, string lastName, int daysAgo)
        {
            clock.Now = DateTimeOffset.Parse("2026-09-26T10:00:00Z").AddDays(-daysAgo);
            await repository.Create(new Member { Id = id, ChurchId = "church", FirstName = firstName, LastName = lastName });
        }
        await Add("member-z", "Sam", "Adams", 1);
        await Add("member-a", "Sam", "Adams", 1);
        await Add("member-b", "Zoe", "Brown", 1);
        await Add("member-old", "Amy", "Smith", 5);

        var query = new Query { ChurchId = "church", PageSize = 2, CreatedOnSort = "newest" };
        var first = await repository.Search(query);
        Assert.Equal(["member-a", "member-z"], first.Items.Select(member => member.Id));
        await Assert.ThrowsAsync<ApiException>(() => repository.Search(query with
        {
            NameSort = "desc", ContinuationToken = first.ContinuationToken
        }));

        var seen = first.Items.Select(member => member.Id).ToList();
        var token = first.ContinuationToken;
        while (token is not null)
        {
            var page = await repository.Search(query with { ContinuationToken = token });
            seen.AddRange(page.Items.Select(member => member.Id));
            token = page.ContinuationToken;
        }
        Assert.Equal(["member-a", "member-z", "member-b", "member-old"], seen);

        var descendingNames = await repository.Search(query with { NameSort = "desc", PageSize = 10 });
        Assert.Equal(["member-b", "member-z", "member-a", "member-old"], descendingNames.Items.Select(member => member.Id));
        var oldest = await repository.Search(query with { CreatedOnSort = "oldest", PageSize = 10 });
        Assert.Equal(["member-old", "member-a", "member-z", "member-b"], oldest.Items.Select(member => member.Id));
    }

    [Fact]
    public void CosmosMemberQueriesUseIndexedDateAndNameOrdering()
    {
        var newest = CosmosRepository<Member>.BuildQuery(new Query { ChurchId = "church", CreatedOnSort = "newest", NameSort = "desc" }).QueryText;
        Assert.Contains("IS_DEFINED(c.createdOn) AND NOT IS_NULL(c.createdOn)", newest);
        Assert.Contains("ORDER BY c.createdOn DESC, c.lastName DESC, c.firstName DESC, c.id DESC", newest);

        var oldest = CosmosRepository<Member>.BuildQuery(new Query { ChurchId = "church", CreatedOnSort = "oldest" }).QueryText;
        Assert.Contains("ORDER BY c.createdOn ASC, c.lastName ASC, c.firstName ASC, c.id ASC", oldest);

        var nameOnly = CosmosRepository<Member>.BuildQuery(new Query { ChurchId = "church", NameSort = "desc" }).QueryText;
        Assert.Contains("ORDER BY c.lastName DESC, c.firstName DESC, c.id DESC", nameOnly);
    }
}