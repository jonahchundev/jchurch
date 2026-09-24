using JChurch.Domain;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public class RepositoryTests
{
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
}