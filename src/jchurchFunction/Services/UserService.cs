using System.Net.Mail;
using JChurch.Domain;
using JChurch.Storage;
using static JChurch.Services.DirectoryService;

namespace JChurch.Services;

// User management is intentionally unauthenticated: validation here is structural only.
// Role/church assignment rules are enforced in the client until backend authorization lands.
public sealed class UserService(Repositories repositories, DirectoryService directory, TimeProvider clock)
{
    public static string NormalizeEmail(string email)
    {
        Require(!string.IsNullOrWhiteSpace(email), "email is required.");
        var normalized = email.Trim().ToLowerInvariant();
        Require(normalized.Length <= 254 && MailAddress.TryCreate(normalized, out var address) && address.Address == normalized, "Invalid email address.");
        Require(normalized.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.' or '@' or '+'), "Invalid email address.");
        return normalized;
    }

    private async Task<User> Validate(User input, CancellationToken cancellationToken)
    {
        var email = NormalizeEmail(input.Email);
        Require(input.Role is "global-admin" or "church-admin" or "user", "role must be global-admin, church-admin, or user.");
        Require(input.ChurchIds is not null && input.ChurchIds.Length <= 100 && input.ChurchIds.All(id => !string.IsNullOrWhiteSpace(id)), "At most 100 valid church IDs are allowed.");
        if (input.Role == "global-admin")
            Require(input.ChurchIds!.Length == 0, "Global admins are implicitly associated with all churches; churchIds must be empty.");
        else
            Require(input.ChurchIds!.Length > 0, "Church admins and users must be associated with at least one church.");
        Require(input.DisplayName is null || input.DisplayName.Trim().Length is > 0 and <= 200, "displayName must be at most 200 characters.");
        Require(input.Status is "invited" or "active", "status must be invited or active.");
        var churchIds = input.ChurchIds!.Select(id => id.Trim()).Distinct().ToArray();
        foreach (var churchId in churchIds)
            await directory.Get<Church>(churchId, churchId, true, cancellationToken);
        return input with
        {
            Id = email,
            ChurchId = User.GlobalPartition,
            Email = email,
            ChurchIds = churchIds,
            DisplayName = input.DisplayName?.Trim(),
            InvitedBy = input.InvitedBy.Trim(),
            SearchText = $"{email} {input.DisplayName?.Trim()}".Trim()
        };
    }

    public async Task<User> Create(User input, CancellationToken cancellationToken = default)
    {
        var user = await Validate(input with { Status = "invited", ClaimedOn = null }, cancellationToken);
        var creation = await repositories.Users.Create(user, cancellationToken);
        if (!creation.Created) throw new ApiException(409, "already_exists", "A user with this email already exists.");
        return creation.Item;
    }

    public async Task<User> Replace(User input, string email, string etag, CancellationToken cancellationToken = default)
    {
        Require(etag != "*", "An exact If-Match ETag is required.");
        email = NormalizeEmail(email);
        var existing = await Get(email, cancellationToken);
        if (!existing.Active) throw new ApiException(409, "archived", "User is archived.");
        Require(NormalizeEmail(input.Email) == email, "email is immutable.");
        var user = await Validate(input with { Status = existing.Status, ClaimedOn = existing.ClaimedOn }, cancellationToken);
        return await repositories.Users.Replace(user with { Active = true }, etag, cancellationToken);
    }

    public async Task<User> Claim(string email, CancellationToken cancellationToken = default)
    {
        email = NormalizeEmail(email);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var existing = await Get(email, cancellationToken);
            if (!existing.Active) throw new ApiException(409, "archived", "User is archived.");
            if (existing.Status == "active") return existing;
            try
            {
                return await repositories.Users.Replace(existing with { Status = "active", ClaimedOn = clock.GetUtcNow() }, existing.ETag, cancellationToken);
            }
            catch (ApiException error) when (error.Code is "stale_version" or "conflict" && attempt == 0) { }
        }
        return await Get(email, cancellationToken);
    }

    public async Task<User> Get(string email, CancellationToken cancellationToken = default)
    {
        var user = await repositories.Users.Get(User.GlobalPartition, NormalizeEmail(email), cancellationToken: cancellationToken);
        return user ?? throw new ApiException(404, "not_found", "User not found.");
    }

    public async Task Archive(string email, string etag, CancellationToken cancellationToken = default)
    {
        Require(etag != "*", "An exact If-Match ETag is required.");
        var existing = await Get(email, cancellationToken);
        await repositories.Users.Replace(existing with { Active = false }, etag, cancellationToken);
    }
}
