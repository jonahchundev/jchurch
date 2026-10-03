using JChurch.Domain;
using JChurch.Storage;

namespace JChurch.Services;

public sealed class MemberImageService(DirectoryService directory, Repositories repositories, IMemberImageStore images)
{
    public const int MaxImageBytes = 1024 * 1024; // 1 MB decoded
    private static readonly HashSet<string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase) { "image/jpeg", "image/png", "image/webp" };

    public async Task<string> Upload(string churchId, string memberId, string contentType, string data, CancellationToken cancellationToken = default)
    {
        DirectoryService.Require(AllowedTypes.Contains(contentType), "Image must be a JPEG, PNG, or WebP file.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(data); }
        catch (FormatException) { throw new ApiException(400, "validation_failed", "Image data must be base64 encoded."); }
        DirectoryService.Require(bytes.Length is > 0 and <= MaxImageBytes, "Image must be at most 1 MB.");
        var member = await directory.Get<Member>(churchId, memberId, true, cancellationToken);
        await images.Put(churchId, memberId, contentType.ToLowerInvariant(), bytes, cancellationToken);
        var version = Guid.NewGuid().ToString("N");
        await BumpImageVersion(member, version, cancellationToken);
        return version;
    }

    public Task<MemberImage?> GetImage(string churchId, string memberId, CancellationToken cancellationToken = default)
    {
        // Photos remain loadable for archived members (attendance history); the blob is the source of truth.
        DirectoryService.ValidateId(churchId);
        DirectoryService.ValidateId(memberId);
        return images.Get(churchId, memberId, cancellationToken);
    }

    public async Task Delete(string churchId, string memberId, CancellationToken cancellationToken = default)
    {
        var member = await directory.Get<Member>(churchId, memberId, cancellationToken: cancellationToken);
        await images.Delete(churchId, memberId, cancellationToken);
        if (member.ImageVersion is not null) await BumpImageVersion(member, null, cancellationToken);
    }

    private async Task BumpImageVersion(Member member, string? version, CancellationToken cancellationToken)
    {
        var current = member;
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await repositories.Members.Replace(current with { ImageVersion = version }, current.ETag, cancellationToken);
                return;
            }
            catch (ApiException error) when (error.Status == 412 && attempt == 0)
            {
                current = await directory.Get<Member>(member.ChurchId, member.Id, true, cancellationToken);
            }
        }
    }
}
