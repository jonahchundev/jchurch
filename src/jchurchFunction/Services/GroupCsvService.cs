using System.Text;
using JChurch.Domain;
using JChurch.Storage;

namespace JChurch.Services;

public sealed record GroupImportRow(string? Id, string? Name, string? ParentName);
public sealed record GroupImportRowResult(int Row, string? Id, string Action, string[]? Errors = null);
public sealed record GroupImportResult(int Created, int Updated, int Failed, IReadOnlyList<GroupImportRowResult> Results);

public sealed class GroupCsvService(Repositories repositories, DirectoryService directory)
{
    public const int MaxImportRows = 500;

    private static readonly string[] Columns = ["Id", "Name", "ParentName"];

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

    public string[] BuildColumns() => Columns;

    public string ImportTemplate() => WriteCsv([Columns]);

    public async Task<string> ExportCsv(string churchId, CancellationToken cancellationToken)
    {
        var groups = await ActiveGroups(churchId, cancellationToken);
        var groupsById = groups.ToDictionary(group => group.Id);
        var topLevel = groups.Where(group => group.ParentGroupId is null).OrderBy(group => group.Name, StringComparer.OrdinalIgnoreCase);
        var rows = new List<string[]> { Columns };
        foreach (var parent in topLevel)
        {
            rows.Add([parent.Id, parent.Name, ""]);
            var children = groups.Where(group => group.ParentGroupId == parent.Id).OrderBy(group => group.Name, StringComparer.OrdinalIgnoreCase);
            foreach (var child in children)
                rows.Add([child.Id, child.Name, parent.Name]);
        }
        return WriteCsv(rows);
    }

    public async Task<GroupImportResult> Import(string churchId, IReadOnlyList<GroupImportRow> rows, CancellationToken cancellationToken)
    {
        if (rows.Count > MaxImportRows) throw new ApiException(400, "too_many_rows", $"At most {MaxImportRows} rows are allowed per import.");

        var groups = await ActiveGroups(churchId, cancellationToken);
        var topLevelByName = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var group in groups.Where(group => group.Active && group.ParentGroupId is null))
            (topLevelByName.TryGetValue(group.Name, out var ids) ? ids : topLevelByName[group.Name] = []).Add(group.Id);

        var results = new List<GroupImportRowResult>();
        int created = 0, updated = 0, failed = 0;
        var rowNumber = 1;
        foreach (var row in rows)
        {
            rowNumber++;
            try
            {
                string? parentId = null;
                if (!string.IsNullOrWhiteSpace(row.ParentName))
                {
                    if (!topLevelByName.TryGetValue(row.ParentName, out var ids) || ids.Count == 0)
                        throw new ApiException(400, "unknown_parent_group", $"No active top-level group named \"{row.ParentName}\".");
                    if (ids.Count > 1)
                        throw new ApiException(400, "ambiguous_parent_group", $"Group name \"{row.ParentName}\" matches more than one top-level group.");
                    parentId = ids[0];
                }

                var group = new Group { Name = row.Name ?? "", ParentGroupId = parentId };
                var id = string.IsNullOrWhiteSpace(row.Id) ? null : row.Id;
                string? etag = null;
                if (id is not null)
                {
                    var existing = await repositories.Groups.Get(churchId, id, cancellationToken: cancellationToken);
                    if (existing is not null) etag = existing.ETag;
                }

                var saved = await directory.Save(group, churchId, id, etag, cancellationToken);
                var action = etag is not null ? "updated" : "created";
                if (action == "updated") updated++; else created++;
                results.Add(new GroupImportRowResult(rowNumber, saved.Id, action));

                // Keep the lookup in sync with this save (handles renames and repeated updates without duplicating entries).
                foreach (var names in topLevelByName.Values) names.Remove(saved.Id);
                if (saved.ParentGroupId is null)
                    (topLevelByName.TryGetValue(saved.Name, out var updatedNames) ? updatedNames : topLevelByName[saved.Name] = []).Add(saved.Id);
            }
            catch (ApiException error)
            {
                failed++;
                results.Add(new GroupImportRowResult(rowNumber, string.IsNullOrWhiteSpace(row.Id) ? null : row.Id, "error", [error.Message]));
            }
        }
        return new GroupImportResult(created, updated, failed, results);
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
