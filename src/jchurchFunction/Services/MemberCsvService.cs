using System.Globalization;
using System.Text;
using System.Text.Json;
using JChurch.Domain;
using JChurch.Storage;

namespace JChurch.Services;

public sealed record MemberImportRow(
    string? Id,
    string? MemberType,
    string? FirstName,
    string? MiddleName,
    string? LastName,
    string? BirthDate,
    string? School,
    string? Phone,
    string? Email,
    string? AllergyDetail,
    string? Groups,
    string? Guardian1FirstName,
    string? Guardian1MiddleName,
    string? Guardian1LastName,
    string? Guardian1Relationship,
    string? Guardian1OtherRelationship,
    string? Guardian1Phone,
    string? Guardian1Email,
    string? Guardian2FirstName,
    string? Guardian2MiddleName,
    string? Guardian2LastName,
    string? Guardian2Relationship,
    string? Guardian2OtherRelationship,
    string? Guardian2Phone,
    string? Guardian2Email,
    Dictionary<string, string>? CustomFields = null);

public sealed record MemberImportRowResult(int Row, string? Id, string Action, string[]? Errors = null);
public sealed record MemberImportResult(int Created, int Updated, int Failed, IReadOnlyList<MemberImportRowResult> Results);

public sealed class MemberCsvService(Repositories repositories, DirectoryService directory)
{
    public const int MaxImportRows = 500;

    private static readonly string[] FixedColumns =
    [
        "Id", "MemberType", "FirstName", "MiddleName", "LastName", "BirthDate", "School", "Phone", "Email", "AllergyDetail", "Groups",
        "Guardian1FirstName", "Guardian1MiddleName", "Guardian1LastName", "Guardian1Relationship", "Guardian1OtherRelationship", "Guardian1Phone", "Guardian1Email",
        "Guardian2FirstName", "Guardian2MiddleName", "Guardian2LastName", "Guardian2Relationship", "Guardian2OtherRelationship", "Guardian2Phone", "Guardian2Email"
    ];

    private async Task<IReadOnlyList<Group>> ActiveGroups(string churchId, CancellationToken cancellationToken)
    {
        var groups = new List<Group>();
        string? token = null;
        do
        {
            var page = await repositories.Groups.Search(new Query { ChurchId = churchId, PageSize = 200, ContinuationToken = token }, cancellationToken);
            groups.AddRange(page.Items);
            token = page.ContinuationToken;
        } while (token is not null);
        return groups;
    }

    private async Task<IReadOnlyList<CustomField>> ActiveCustomFields(string churchId, CancellationToken cancellationToken)
    {
        var fields = new List<CustomField>();
        string? token = null;
        do
        {
            var page = await repositories.Fields.Search(new Query { ChurchId = churchId, PageSize = 200, ContinuationToken = token }, cancellationToken);
            fields.AddRange(page.Items);
            token = page.ContinuationToken;
        } while (token is not null);
        return fields;
    }

    private async Task<IReadOnlyList<Member>> ActiveMembers(string churchId, CancellationToken cancellationToken)
    {
        var members = new List<Member>();
        string? token = null;
        do
        {
            var page = await repositories.Members.Search(new Query { ChurchId = churchId, PageSize = 200, ContinuationToken = token }, cancellationToken);
            members.AddRange(page.Items);
            token = page.ContinuationToken;
        } while (token is not null);
        return members;
    }

    private static string GroupLabel(Group group, IReadOnlyDictionary<string, Group> byId) =>
        group.ParentGroupId is not null && byId.TryGetValue(group.ParentGroupId, out var parent) ? $"{parent.Name} / {group.Name}" : group.Name;

    public async Task<string[]> BuildColumns(string churchId, CancellationToken cancellationToken)
    {
        var fields = await ActiveCustomFields(churchId, cancellationToken);
        return [.. FixedColumns, .. fields.Select(field => field.Name)];
    }

    public async Task<string> ImportTemplate(string churchId, CancellationToken cancellationToken)
    {
        var columns = await BuildColumns(churchId, cancellationToken);
        return WriteCsv([columns]);
    }

    public async Task<string> ExportCsv(string churchId, CancellationToken cancellationToken)
    {
        var groups = await ActiveGroups(churchId, cancellationToken);
        var groupsById = groups.ToDictionary(group => group.Id);
        var fields = (await ActiveCustomFields(churchId, cancellationToken)).ToArray();
        var columns = (string[])[.. FixedColumns, .. fields.Select(field => field.Name)];
        var members = await ActiveMembers(churchId, cancellationToken);

        var rows = new List<string[]> { columns };
        foreach (var member in members)
        {
            var groupLabels = member.GroupIds
                .Select(id => groupsById.TryGetValue(id, out var group) ? GroupLabel(group, groupsById) : null)
                .Where(label => label is not null)
                .ToArray();
            var row = new Dictionary<string, string>
            {
                ["Id"] = member.Id,
                ["MemberType"] = member.MemberType,
                ["FirstName"] = member.FirstName,
                ["MiddleName"] = member.MiddleName ?? "",
                ["LastName"] = member.LastName,
                ["BirthDate"] = member.BirthDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "",
                ["School"] = member.School ?? "",
                ["Phone"] = member.Phone ?? "",
                ["Email"] = member.Email ?? "",
                ["AllergyDetail"] = member.AllergyDetail ?? "",
                ["Groups"] = string.Join(":", groupLabels),
                ["Guardian1FirstName"] = member.Guardian1?.FirstName ?? "",
                ["Guardian1MiddleName"] = member.Guardian1?.MiddleName ?? "",
                ["Guardian1LastName"] = member.Guardian1?.LastName ?? "",
                ["Guardian1Relationship"] = member.Guardian1?.Relationship ?? "",
                ["Guardian1OtherRelationship"] = member.Guardian1?.OtherRelationship ?? "",
                ["Guardian1Phone"] = member.Guardian1?.Phone ?? "",
                ["Guardian1Email"] = member.Guardian1?.Email ?? "",
                ["Guardian2FirstName"] = member.Guardian2?.FirstName ?? "",
                ["Guardian2MiddleName"] = member.Guardian2?.MiddleName ?? "",
                ["Guardian2LastName"] = member.Guardian2?.LastName ?? "",
                ["Guardian2Relationship"] = member.Guardian2?.Relationship ?? "",
                ["Guardian2OtherRelationship"] = member.Guardian2?.OtherRelationship ?? "",
                ["Guardian2Phone"] = member.Guardian2?.Phone ?? "",
                ["Guardian2Email"] = member.Guardian2?.Email ?? ""
            };
            foreach (var field in fields)
                row[field.Name] = member.CustomFields.TryGetValue(field.Id, out var value) ? FormatCustomFieldValue(value) : "";
            rows.Add(columns.Select(column => row.GetValueOrDefault(column, "")).ToArray());
        }
        return WriteCsv(rows);
    }

    private static string FormatCustomFieldValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? "",
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => ""
    };

    public async Task<MemberImportResult> Import(string churchId, IReadOnlyList<MemberImportRow> rows, CancellationToken cancellationToken)
    {
        if (rows.Count > MaxImportRows) throw new ApiException(400, "too_many_rows", $"At most {MaxImportRows} rows are allowed per import.");

        var groups = await ActiveGroups(churchId, cancellationToken);
        var groupsById = groups.ToDictionary(group => group.Id);
        var groupNameLookup = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var group in groups.Where(group => group.Active))
        {
            foreach (var label in new[] { group.Name, GroupLabel(group, groupsById) }.Distinct())
                (groupNameLookup.TryGetValue(label, out var ids) ? ids : groupNameLookup[label] = []).Add(group.Id);
        }

        var fields = await ActiveCustomFields(churchId, cancellationToken);
        var fieldsByName = new Dictionary<string, List<CustomField>>(StringComparer.Ordinal);
        foreach (var field in fields.Where(field => field.Active))
            (fieldsByName.TryGetValue(field.Name, out var list) ? list : fieldsByName[field.Name] = []).Add(field);

        var results = new List<MemberImportRowResult>();
        int created = 0, updated = 0, failed = 0;
        var rowNumber = 1;
        foreach (var row in rows)
        {
            rowNumber++;
            try
            {
                var (member, id, etag) = await BuildMember(churchId, row, groupNameLookup, fieldsByName, cancellationToken);
                var saved = await directory.Save(member, churchId, id, etag, cancellationToken);
                var action = etag is not null ? "updated" : "created";
                if (action == "updated") updated++; else created++;
                results.Add(new MemberImportRowResult(rowNumber, saved.Id, action));
            }
            catch (ApiException error)
            {
                failed++;
                results.Add(new MemberImportRowResult(rowNumber, string.IsNullOrWhiteSpace(row.Id) ? null : row.Id, "error", [error.Message]));
            }
        }
        return new MemberImportResult(created, updated, failed, results);
    }

    private async Task<(Member Member, string? Id, string? ETag)> BuildMember(string churchId, MemberImportRow row, IReadOnlyDictionary<string, List<string>> groupNameLookup, IReadOnlyDictionary<string, List<CustomField>> fieldsByName, CancellationToken cancellationToken)
    {
        var groupIds = new List<string>();
        foreach (var name in (row.Groups ?? "").Split(':', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!groupNameLookup.TryGetValue(name, out var ids) || ids.Count == 0)
                throw new ApiException(400, "unknown_group", $"No active group named \"{name}\".");
            if (ids.Count > 1)
                throw new ApiException(400, "ambiguous_group", $"Group name \"{name}\" matches more than one group; use \"Parent / Child\".");
            groupIds.Add(ids[0]);
        }

        var customFields = new Dictionary<string, JsonElement>();
        foreach (var (name, raw) in row.CustomFields ?? [])
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            if (!fieldsByName.TryGetValue(name, out var candidates) || candidates.Count == 0)
                throw new ApiException(400, "unknown_custom_field", $"No active custom field named \"{name}\".");
            if (candidates.Count > 1)
                throw new ApiException(400, "ambiguous_custom_field", $"Custom field name \"{name}\" matches more than one field.");
            var field = candidates[0];
            customFields[field.Id] = field.FieldType switch
            {
                "number" => decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var number)
                    ? JsonSerializer.SerializeToElement(number)
                    : throw new ApiException(400, "invalid_custom_field", $"Value for \"{name}\" must be a number."),
                "boolean" => bool.TryParse(raw, out var flag)
                    ? JsonSerializer.SerializeToElement(flag)
                    : throw new ApiException(400, "invalid_custom_field", $"Value for \"{name}\" must be true or false."),
                "date" => DateOnly.TryParseExact(raw, "yyyy-MM-dd", out _)
                    ? JsonSerializer.SerializeToElement(raw)
                    : throw new ApiException(400, "invalid_custom_field", $"Value for \"{name}\" must be yyyy-MM-dd."),
                _ => JsonSerializer.SerializeToElement(raw)
            };
        }

        var member = new Member
        {
            MemberType = row.MemberType ?? "",
            FirstName = row.FirstName ?? "",
            MiddleName = string.IsNullOrWhiteSpace(row.MiddleName) ? null : row.MiddleName,
            LastName = row.LastName ?? "",
            BirthDate = string.IsNullOrWhiteSpace(row.BirthDate) ? null
                : DateOnly.TryParseExact(row.BirthDate, "yyyy-MM-dd", out var birthDate) ? birthDate
                : throw new ApiException(400, "invalid_birth_date", "birthDate must be yyyy-MM-dd."),
            School = string.IsNullOrWhiteSpace(row.School) ? null : row.School,
            Phone = string.IsNullOrWhiteSpace(row.Phone) ? null : row.Phone,
            Email = string.IsNullOrWhiteSpace(row.Email) ? null : row.Email,
            AllergyDetail = string.IsNullOrWhiteSpace(row.AllergyDetail) ? null : row.AllergyDetail,
            Guardian1 = BuildGuardian(row.Guardian1FirstName, row.Guardian1MiddleName, row.Guardian1LastName, row.Guardian1Relationship, row.Guardian1OtherRelationship, row.Guardian1Phone, row.Guardian1Email),
            Guardian2 = BuildGuardian(row.Guardian2FirstName, row.Guardian2MiddleName, row.Guardian2LastName, row.Guardian2Relationship, row.Guardian2OtherRelationship, row.Guardian2Phone, row.Guardian2Email),
            GroupIds = [.. groupIds],
            CustomFields = customFields
        };

        var id = string.IsNullOrWhiteSpace(row.Id) ? null : row.Id;
        if (id is null) return (member, null, null);
        var existing = await repositories.Members.Get(churchId, id, cancellationToken: cancellationToken);
        return existing is null ? (member, id, null) : (member, id, existing.ETag);
    }

    private static Guardian? BuildGuardian(string? firstName, string? middleName, string? lastName, string? relationship, string? otherRelationship, string? phone, string? email)
    {
        if (string.IsNullOrWhiteSpace(firstName) && string.IsNullOrWhiteSpace(middleName) && string.IsNullOrWhiteSpace(lastName)
            && string.IsNullOrWhiteSpace(relationship) && string.IsNullOrWhiteSpace(otherRelationship) && string.IsNullOrWhiteSpace(phone) && string.IsNullOrWhiteSpace(email))
            return null;
        return new Guardian
        {
            FirstName = firstName ?? "",
            MiddleName = string.IsNullOrWhiteSpace(middleName) ? null : middleName,
            LastName = lastName ?? "",
            Relationship = relationship ?? "",
            OtherRelationship = string.IsNullOrWhiteSpace(otherRelationship) ? null : otherRelationship,
            Phone = phone ?? "",
            Email = email ?? ""
        };
    }

    private static string WriteCsv(IEnumerable<string[]> rows)
    {
        var builder = new StringBuilder();
        foreach (var row in rows)
            builder.AppendLine(string.Join(",", row.Select(QuoteCsvField)));
        return builder.ToString();
    }

    private static string QuoteCsvField(string value) =>
        value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;
}
