using System.Net.Mail;
using System.Text.Json;
using JChurch.Domain;
using JChurch.Storage;

namespace JChurch.Services;

public sealed class DirectoryService(Repositories repositories, TimeProvider clock)
{
    public static void Require(bool condition, string message)
    {
        if (!condition) throw new ApiException(400, "validation_failed", message);
    }

    public static void ValidateId(string id)
    {
        Require(!string.IsNullOrWhiteSpace(id) && id.Length <= 160 && id.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_'), "Invalid resource ID.");
    }

    public static void Name(string? value, string field) => Require(!string.IsNullOrWhiteSpace(value) && value.Length <= 200, $"{field} is required and must be at most 200 characters.");

    private static Guardian ValidateGuardian(Guardian guardian, string field)
    {
        Name(guardian.FirstName, $"{field}.firstName");
        Name(guardian.LastName, $"{field}.lastName");
        Require(guardian.MiddleName?.Length is not > 200, $"{field}.middleName is too long.");
        Require(guardian.Relationship is "Mother" or "Father" or "Grandmother" or "Grandfather" or "Others", $"Invalid {field}.relationship.");
        if (guardian.Relationship == "Others")
            Require(!string.IsNullOrWhiteSpace(guardian.OtherRelationship) && guardian.OtherRelationship.Length <= 50, $"{field}.otherRelationship is required and must be at most 50 characters.");
        else
            Require(string.IsNullOrWhiteSpace(guardian.OtherRelationship), $"{field}.otherRelationship is only allowed when relationship is Others.");
        Require(!string.IsNullOrWhiteSpace(guardian.Phone) && guardian.Phone.Length <= 50, $"{field}.phone is required and must be at most 50 characters.");
        Require(!string.IsNullOrWhiteSpace(guardian.Email) && guardian.Email.Length <= 254 && MailAddress.TryCreate(guardian.Email, out var address) && address.Address == guardian.Email, $"Invalid {field}.email.");
        return guardian with
        {
            FirstName = guardian.FirstName.Trim(),
            MiddleName = guardian.MiddleName?.Trim(),
            LastName = guardian.LastName.Trim(),
            OtherRelationship = guardian.OtherRelationship?.Trim(),
            Phone = guardian.Phone.Trim(),
            Email = guardian.Email.Trim()
        };
    }

    private static bool EmptyGuardian(Guardian? guardian) => guardian is not null && string.IsNullOrWhiteSpace(guardian.FirstName) && string.IsNullOrWhiteSpace(guardian.MiddleName) && string.IsNullOrWhiteSpace(guardian.LastName) && string.IsNullOrWhiteSpace(guardian.Relationship) && string.IsNullOrWhiteSpace(guardian.OtherRelationship) && string.IsNullOrWhiteSpace(guardian.Phone) && string.IsNullOrWhiteSpace(guardian.Email);

    public async Task<T> Get<T>(string churchId, string id, bool active = false, CancellationToken cancellationToken = default) where T : Document
    {
        ValidateId(churchId);
        ValidateId(id);
        var document = await repositories.For<T>().Get(churchId, id, cancellationToken: cancellationToken);
        if (document is null) throw new ApiException(404, "not_found", "Resource not found in this church.");
        if (active && !document.Active) throw new ApiException(409, "archived", "Resource is archived.");
        return document;
    }

    public Task<Church> ActiveChurch(string churchId, CancellationToken cancellationToken = default) => Get<Church>(churchId, churchId, true, cancellationToken);

    public async Task<T> Save<T>(T input, string? churchId, string? id = null, string? etag = null, CancellationToken cancellationToken = default) where T : Document
    {
        Require(input.Active, "Use DELETE to archive a resource; archived resources cannot be reactivated.");
        id ??= $"{typeof(T).Name.ToLowerInvariant()}_{Guid.NewGuid():N}";
        churchId = typeof(T) == typeof(Church) ? id : churchId;
        ValidateId(id);
        Require(churchId is not null, "churchId is required.");
        if (typeof(T) != typeof(Church)) await ActiveChurch(churchId!, cancellationToken);
        T? existing = null;
        if (etag is not null)
        {
            Require(etag != "*", "An exact If-Match ETag is required.");
            existing = await Get<T>(churchId!, id, true, cancellationToken);
            if (existing.ETag != etag) throw new ApiException(412, "stale_version", "ETag is stale.");
        }
        Document document = input with { Id = id, ChurchId = churchId!, ETag = "" };
        switch (document)
        {
            case Church church:
                Name(church.Name, "name");
                Require(church.ScanCodeFormat is null or "qr" or "code128", "scanCodeFormat must be qr or code128.");
                document = church with { Name = church.Name.Trim(), ScanCodeFormat = church.ScanCodeFormat ?? "qr", SearchText = church.Name.Trim() };
                break;
            case Group group:
                Name(group.Name, "name");
                if (existing is Group oldGroup) Require(oldGroup.ParentGroupId == group.ParentGroupId, "A group's parent is immutable; create a new group to change hierarchy.");
                if (group.ParentGroupId is not null)
                {
                    Require(group.ParentGroupId != id, "A group cannot be its own parent.");
                    var parent = await Get<Group>(churchId!, group.ParentGroupId, true, cancellationToken);
                    Require(parent.ParentGroupId is null, "Only one subgroup level is supported.");
                }
                document = group with { Name = group.Name.Trim(), SearchText = group.Name.Trim() };
                break;
            case Member member:
                if (existing is Member previous)
                    member = member with
                    {
                        ScanCode = member.ScanCodeSpecified || member.ScanCode is not null ? member.ScanCode : previous.ScanCode,
                        ScanCodeFormat = member.ScanCodeFormatSpecified || member.ScanCodeFormat is not null ? member.ScanCodeFormat : previous.ScanCodeFormat
                    };
                member = ScanCodes.Normalize(member);
                Require(member.MemberType is "child" or "adult", "memberType must be child or adult.");
                Name(member.FirstName, "firstName");
                Name(member.LastName, "lastName");
                Require(member.MiddleName?.Length is not > 200 && member.School?.Length is not > 200 && member.Phone?.Length is not > 50 && member.AllergyDetail?.Length is not > 1000, "Optional member fields are too long.");
                Require(member.BirthDate is null || member.BirthDate <= DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime), "birthDate cannot be in the future.");
                Require(member.Email is null || (member.Email.Length <= 254 && MailAddress.TryCreate(member.Email, out var address) && address.Address == member.Email), "Invalid email address.");
                if (member.MemberType == "child")
                {
                    Require(member.Guardian1 is not null, "guardian1 is required for child members.");
                    member = member with
                    {
                        Guardian1 = ValidateGuardian(member.Guardian1!, "guardian1"),
                        Guardian2 = member.Guardian2 is null ? null : ValidateGuardian(member.Guardian2, "guardian2")
                    };
                }
                else
                {
                    member = member with
                    {
                        School = string.IsNullOrWhiteSpace(member.School) ? null : member.School,
                        Guardian1 = EmptyGuardian(member.Guardian1) ? null : member.Guardian1,
                        Guardian2 = EmptyGuardian(member.Guardian2) ? null : member.Guardian2
                    };
                    Require(member.Guardian1 is null && member.Guardian2 is null, "Adults cannot have guardian information.");
                    Require(string.IsNullOrWhiteSpace(member.School), "Adults cannot have school information.");
                    member = member with { School = null };
                }
                Require(member.GroupIds is not null && member.GroupIds.Length <= 50 && member.GroupIds.All(groupId => !string.IsNullOrWhiteSpace(groupId)), "At most 50 valid group IDs are allowed.");
                foreach (var groupId in member.GroupIds!.Distinct()) await Get<Group>(churchId!, groupId, true, cancellationToken);
                Require(member.CustomFields is not null && member.CustomFields.Count <= 50, "At most 50 custom fields are allowed.");
                foreach (var field in member.CustomFields!)
                {
                    var definition = await Get<CustomField>(churchId!, field.Key, true, cancellationToken);
                    var valid = definition.FieldType switch
                    {
                        "text" => field.Value.ValueKind == JsonValueKind.String && field.Value.GetString()!.Length <= 1000,
                        "number" => field.Value.ValueKind == JsonValueKind.Number && field.Value.TryGetDecimal(out _),
                        "boolean" => field.Value.ValueKind is JsonValueKind.True or JsonValueKind.False,
                        "date" => field.Value.ValueKind == JsonValueKind.String && DateOnly.TryParseExact(field.Value.GetString(), "yyyy-MM-dd", out _),
                        _ => false
                    };
                    Require(valid, $"Invalid value for custom field {field.Key}.");
                }
                document = member with { FirstName = member.FirstName.Trim(), LastName = member.LastName.Trim(), MiddleName = member.MiddleName?.Trim(), School = member.School?.Trim(), AllergyDetail = member.AllergyDetail?.Trim(), GroupIds = member.GroupIds!.Distinct().ToArray(), SearchText = $"{member.FirstName.Trim()} {member.MiddleName} {member.LastName.Trim()}" };
                break;
            case CustomField field:
                Name(field.Name, "name");
                Require(field.FieldType is "text" or "number" or "boolean" or "date", "fieldType must be text, number, boolean, or date.");
                if (existing is CustomField oldField) Require(oldField.FieldType == field.FieldType, "Custom field type is immutable.");
                document = field with { Name = field.Name.Trim(), SearchText = field.Name.Trim() };
                break;
            default:
                throw new InvalidOperationException("Unsupported directory resource.");
        }
        if (existing is not null) return await repositories.For<T>().Replace((T)document, etag!, cancellationToken);
        var creation = await repositories.For<T>().Create((T)document, cancellationToken);
        if (!creation.Created) throw new ApiException(409, "already_exists", "Resource already exists.");
        return creation.Item;
    }

    public async Task Archive<T>(string churchId, string id, string etag, CancellationToken cancellationToken = default) where T : Document
    {
        await ActiveChurch(churchId, cancellationToken);
        var existing = await Get<T>(churchId, id, cancellationToken: cancellationToken);
        if (existing is Group)
        {
            var children = await repositories.Groups.Search(new Query { ChurchId = churchId, ParentGroupId = id, PageSize = 1 }, cancellationToken);
            if (children.Items.Count > 0 || children.ContinuationToken is not null)
                throw new ApiException(409, "has_subgroups", "Archive subgroups before their parent.");
        }
        await repositories.For<T>().Replace(existing with { Active = false }, etag, cancellationToken);
    }
}