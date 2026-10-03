using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public sealed class MemberImageServiceTests
{
    private static (MemberImageService images, DirectoryService directory) Fixture()
    {
        var repositories = ServiceTests.Memory();
        var directory = new DirectoryService(repositories, new TestClock(DateTimeOffset.Parse("2026-10-02T10:00:00Z")));
        return (new MemberImageService(directory, repositories, new InMemoryMemberImageStore()), directory);
    }

    private static async Task<(Church Church, Member Member)> Setup(DirectoryService directory)
    {
        var church = await directory.Save(new Church { Name = "Synthetic Church" }, null);
        var member = await directory.Save(new Member { MemberType = "adult", FirstName = "Ada", LastName = "Lovelace" }, church.Id);
        return (church, member);
    }

    // Minimal JPEG header bytes; content is not inspected, only type and size.
    private static readonly string Jpeg = Convert.ToBase64String([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);

    [Fact]
    public async Task UploadRoundTripsAndBumpsImageVersion()
    {
        var (images, directory) = Fixture();
        var (church, member) = await Setup(directory);
        Assert.Null(member.ImageVersion);

        var version = await images.Upload(church.Id, member.Id, "image/jpeg", Jpeg);
        Assert.False(string.IsNullOrEmpty(version));

        var refreshed = await directory.Get<Member>(church.Id, member.Id);
        Assert.Equal(version, refreshed.ImageVersion);

        var image = await images.GetImage(church.Id, member.Id);
        Assert.NotNull(image);
        Assert.Equal("image/jpeg", image.ContentType);
        Assert.Equal(Convert.FromBase64String(Jpeg), image.Content);

        var replaced = await images.Upload(church.Id, member.Id, "image/png", Jpeg);
        Assert.NotEqual(version, replaced);
        Assert.Equal(replaced, (await directory.Get<Member>(church.Id, member.Id)).ImageVersion);
        Assert.Equal("image/png", (await images.GetImage(church.Id, member.Id))!.ContentType);
    }

    [Fact]
    public async Task UploadValidatesTypeBase64AndSize()
    {
        var (images, directory) = Fixture();
        var (church, member) = await Setup(directory);

        var type = await Assert.ThrowsAsync<ApiException>(() => images.Upload(church.Id, member.Id, "image/gif", Jpeg));
        Assert.Equal("validation_failed", type.Code);

        var malformed = await Assert.ThrowsAsync<ApiException>(() => images.Upload(church.Id, member.Id, "image/jpeg", "!!!not-base64!!!"));
        Assert.Equal("validation_failed", malformed.Code);

        var oversized = Convert.ToBase64String(new byte[MemberImageService.MaxImageBytes + 1]);
        var tooLarge = await Assert.ThrowsAsync<ApiException>(() => images.Upload(church.Id, member.Id, "image/jpeg", oversized));
        Assert.Equal("validation_failed", tooLarge.Code);

        Assert.Null((await directory.Get<Member>(church.Id, member.Id)).ImageVersion);
        Assert.Null(await images.GetImage(church.Id, member.Id));
    }

    [Fact]
    public async Task UploadRequiresActiveMember()
    {
        var (images, directory) = Fixture();
        var (church, member) = await Setup(directory);
        Assert.Equal("not_found", (await Assert.ThrowsAsync<ApiException>(() => images.Upload(church.Id, "member_missing", "image/jpeg", Jpeg))).Code);
        await directory.Archive<Member>(church.Id, member.Id, member.ETag);
        Assert.Equal("archived", (await Assert.ThrowsAsync<ApiException>(() => images.Upload(church.Id, member.Id, "image/jpeg", Jpeg))).Code);
    }

    [Fact]
    public async Task DeleteRemovesBlobAndClearsImageVersion()
    {
        var (images, directory) = Fixture();
        var (church, member) = await Setup(directory);
        await images.Upload(church.Id, member.Id, "image/jpeg", Jpeg);

        await images.Delete(church.Id, member.Id);
        Assert.Null(await images.GetImage(church.Id, member.Id));
        Assert.Null((await directory.Get<Member>(church.Id, member.Id)).ImageVersion);

        // Idempotent: deleting again succeeds with no photo present.
        await images.Delete(church.Id, member.Id);
    }

    [Fact]
    public async Task MemberSavePreservesImageVersion()
    {
        var (images, directory) = Fixture();
        var (church, member) = await Setup(directory);
        var version = await images.Upload(church.Id, member.Id, "image/jpeg", Jpeg);
        var current = await directory.Get<Member>(church.Id, member.Id);

        // A normal edit must not drop the photo link, even though clients never send imageVersion.
        var renamed = await directory.Save(current with { FirstName = "Augusta", ImageVersion = null }, church.Id, current.Id, current.ETag);
        Assert.Equal(version, renamed.ImageVersion);
    }

    [Fact]
    public async Task GetImageReturnsNullWithoutPhoto()
    {
        var (images, directory) = Fixture();
        var (church, member) = await Setup(directory);
        Assert.Null(await images.GetImage(church.Id, member.Id));
    }
}
