using JChurch.Domain;
using JChurch.Services;
using Xunit;

namespace JChurch.Tests;

public sealed class UserServiceTests
{
    private static (UserService users, DirectoryService directory, TestClock clock) Fixture()
    {
        var repositories = ServiceTests.Memory();
        var clock = new TestClock(DateTimeOffset.Parse("2026-10-02T10:00:00Z"));
        var directory = new DirectoryService(repositories, clock);
        return (new UserService(repositories, directory, clock), directory, clock);
    }

    private static async Task<Church> Church(DirectoryService directory, string name = "Synthetic Church") =>
        await directory.Save(new Church { Name = name }, null);

    [Fact]
    public async Task CreateNormalizesEmailAndDefaultsToInvited()
    {
        var (users, directory, _) = Fixture();
        var church = await Church(directory);
        var user = await users.Create(new User { Email = "  Jane.Doe@Example.COM ", Role = "church-admin", ChurchIds = [church.Id], InvitedBy = "admin" });
        Assert.Equal("jane.doe@example.com", user.Id);
        Assert.Equal("jane.doe@example.com", user.Email);
        Assert.Equal(User.GlobalPartition, user.ChurchId);
        Assert.Equal("invited", user.Status);
        Assert.Null(user.ClaimedOn);
    }

    [Fact]
    public async Task CreateValidatesRoleEmailAndChurches()
    {
        var (users, directory, _) = Fixture();
        var church = await Church(directory);
        await Assert.ThrowsAsync<ApiException>(() => users.Create(new User { Email = "a@b.com", Role = "super", ChurchIds = [church.Id] }));
        await Assert.ThrowsAsync<ApiException>(() => users.Create(new User { Email = "not-an-email", Role = "user", ChurchIds = [church.Id] }));
        await Assert.ThrowsAsync<ApiException>(() => users.Create(new User { Email = "a@b.com", Role = "user", ChurchIds = ["missing_church"] }));
        await Assert.ThrowsAsync<ApiException>(() => users.Create(new User { Email = "a@b.com", Role = "church-admin", ChurchIds = [] }));
        await Assert.ThrowsAsync<ApiException>(() => users.Create(new User { Email = "a@b.com", Role = "global-admin", ChurchIds = [church.Id] }));
        var global = await users.Create(new User { Email = "root@example.com", Role = "global-admin", InvitedBy = "admin" });
        Assert.Empty(global.ChurchIds);
    }

    [Fact]
    public async Task CreateDuplicateEmailConflicts()
    {
        var (users, directory, _) = Fixture();
        var church = await Church(directory);
        await users.Create(new User { Email = "dup@example.com", Role = "user", ChurchIds = [church.Id] });
        var error = await Assert.ThrowsAsync<ApiException>(() => users.Create(new User { Email = "DUP@example.com", Role = "user", ChurchIds = [church.Id] }));
        Assert.Equal("already_exists", error.Code);
    }

    [Fact]
    public async Task ClaimTransitionsInvitedToActiveAndIsIdempotent()
    {
        var (users, directory, clock) = Fixture();
        var church = await Church(directory);
        var invited = await users.Create(new User { Email = "claim@example.com", Role = "user", ChurchIds = [church.Id] });
        var claimed = await users.Claim("CLAIM@example.com");
        Assert.Equal("active", claimed.Status);
        Assert.Equal(clock.GetUtcNow(), claimed.ClaimedOn);
        var again = await users.Claim("claim@example.com");
        Assert.Equal("active", again.Status);
        Assert.Equal(claimed.ClaimedOn, again.ClaimedOn);
    }

    [Fact]
    public async Task ClaimMissingOrArchivedFails()
    {
        var (users, directory, _) = Fixture();
        var church = await Church(directory);
        Assert.Equal("not_found", (await Assert.ThrowsAsync<ApiException>(() => users.Claim("ghost@example.com"))).Code);
        var user = await users.Create(new User { Email = "archived@example.com", Role = "user", ChurchIds = [church.Id] });
        await users.Archive(user.Email, user.ETag);
        Assert.Equal("archived", (await Assert.ThrowsAsync<ApiException>(() => users.Claim("archived@example.com"))).Code);
    }

    [Fact]
    public async Task ReplaceUpdatesAssignmentsButNotEmailOrStatus()
    {
        var (users, directory, _) = Fixture();
        var one = await Church(directory, "One");
        var two = await Church(directory, "Two");
        var user = await users.Create(new User { Email = "edit@example.com", Role = "user", ChurchIds = [one.Id] });
        var updated = await users.Replace(new User { Email = "EDIT@example.com", Role = "church-admin", ChurchIds = [one.Id, two.Id], DisplayName = "Editor" }, user.Email, user.ETag);
        Assert.Equal("church-admin", updated.Role);
        Assert.Equal([one.Id, two.Id], updated.ChurchIds);
        Assert.Equal("invited", updated.Status);
        Assert.Equal("stale_version", (await Assert.ThrowsAsync<ApiException>(() => users.Replace(updated, updated.Email, user.ETag))).Code);
        Assert.Equal("validation_failed", (await Assert.ThrowsAsync<ApiException>(() => users.Replace(updated with { Email = "other@example.com" }, updated.Email, updated.ETag))).Code);
        // Attempting to force a status change via Replace is ignored (status is claim-only).
        var forced = await users.Replace(updated with { Status = "active", ClaimedOn = DateTimeOffset.Parse("2020-01-01T00:00:00Z") }, updated.Email, updated.ETag);
        Assert.Equal("invited", forced.Status);
        Assert.Null(forced.ClaimedOn);
    }

    [Fact]
    public async Task ArchiveSoftDeletesAndBlocksReactivation()
    {
        var (users, directory, _) = Fixture();
        var church = await Church(directory);
        var user = await users.Create(new User { Email = "archive@example.com", Role = "user", ChurchIds = [church.Id] });
        await users.Archive(user.Email, user.ETag);
        var fetched = await users.Get(user.Email);
        Assert.False(fetched.Active);
        Assert.Equal("archived", (await Assert.ThrowsAsync<ApiException>(() => users.Replace(fetched, fetched.Email, fetched.ETag))).Code);
    }

    [Fact]
    public async Task SearchTextMatchesEmailAndDisplayName()
    {
        var (users, directory, _) = Fixture();
        var church = await Church(directory);
        var user = await users.Create(new User { Email = "find@example.com", Role = "user", ChurchIds = [church.Id], DisplayName = "Find Me" });
        Assert.Contains("find@example.com", user.SearchText);
        Assert.Contains("Find Me", user.SearchText);
    }
}
