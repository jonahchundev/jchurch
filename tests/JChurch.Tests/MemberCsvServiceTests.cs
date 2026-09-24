using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public sealed class MemberCsvServiceTests
{
    private static (Repositories Repositories, DirectoryService Directory, MemberCsvService Csv) Setup() =>
        Build(ServiceTests.Memory());

    private static (Repositories, DirectoryService, MemberCsvService) Build(Repositories repositories)
    {
        var directory = new DirectoryService(repositories, TimeProvider.System);
        return (repositories, directory, new MemberCsvService(repositories, directory));
    }

    [Fact]
    public async Task TemplateHasFixedAndCustomFieldColumns()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Template" }, null);
        await directory.Save(new CustomField { Name = "Allergy Info", FieldType = "text" }, church.Id);

        var template = await csv.ImportTemplate(church.Id, default);
        var header = template.Split('\n')[0].TrimEnd('\r');
        Assert.Contains("Id,MemberType,FirstName", header);
        Assert.EndsWith("Allergy Info", header);
        Assert.Single(template.TrimEnd('\n', '\r').Split('\n'));
    }

    [Fact]
    public async Task ExportRoundTripsGroupsAndCustomFields()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Export" }, null);
        var parent = await directory.Save(new Group { Name = "Youth" }, church.Id);
        var child = await directory.Save(new Group { Name = "Choir", ParentGroupId = parent.Id }, church.Id);
        var field = await directory.Save(new CustomField { Name = "Notes", FieldType = "text" }, church.Id);
        var member = await directory.Save(new Member
        {
            MemberType = "adult", FirstName = "Ada", LastName = "Lovelace", GroupIds = [child.Id],
            CustomFields = new() { [field.Id] = System.Text.Json.JsonSerializer.SerializeToElement("VIP") }
        }, church.Id);

        var text = await csv.ExportCsv(church.Id, default);
        var lines = text.TrimEnd('\n', '\r').Split('\n');
        Assert.Equal(2, lines.Length);
        Assert.Contains(member.Id, lines[1]);
        Assert.Contains("Youth / Choir", lines[1]);
        Assert.Contains("VIP", lines[1]);
    }

    [Fact]
    public async Task ImportCreatesMemberWithGroupsAndCustomFields()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Import" }, null);
        var group = await directory.Save(new Group { Name = "Youth" }, church.Id);
        var field = await directory.Save(new CustomField { Name = "Notes", FieldType = "text" }, church.Id);

        var row = new MemberImportRow(null, "adult", "Ada", null, "Lovelace", null, null, null, null, null, "Youth",
            null, null, null, null, null, null, null, null, null, null, null, null, null, null,
            new() { ["Notes"] = "VIP" });
        var result = await csv.Import(church.Id, [row], default);

        Assert.Equal(1, result.Created);
        Assert.Equal(0, result.Failed);
        var created = (await repositories.Members.Search(new Query { ChurchId = church.Id })).Items.Single();
        Assert.Equal([group.Id], created.GroupIds);
        Assert.Equal("VIP", created.CustomFields[field.Id].GetString());
    }

    [Fact]
    public async Task ImportUpdatesExistingMemberById()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Update" }, null);
        var member = await directory.Save(new Member { MemberType = "adult", FirstName = "Ada", LastName = "Lovelace" }, church.Id);

        var row = new MemberImportRow(member.Id, "adult", "Ada", null, "Byron", null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
        var result = await csv.Import(church.Id, [row], default);

        Assert.Equal(0, result.Created);
        Assert.Equal(1, result.Updated);
        var updated = await repositories.Members.Get(church.Id, member.Id);
        Assert.Equal("Byron", updated!.LastName);
    }

    [Fact]
    public async Task ImportReportsPerRowErrorsAndContinues()
    {
        var (_, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Errors" }, null);

        var badGroup = new MemberImportRow(null, "adult", "Ada", null, "Lovelace", null, null, null, null, null, "NoSuchGroup",
            null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
        var missingGuardian = new MemberImportRow(null, "child", "Kid", null, "One", null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
        var good = new MemberImportRow(null, "adult", "Grace", null, "Hopper", null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);

        var result = await csv.Import(church.Id, [badGroup, missingGuardian, good], default);

        Assert.Equal(1, result.Created);
        Assert.Equal(2, result.Failed);
        Assert.Equal("error", result.Results[0].Action);
        Assert.Equal("error", result.Results[1].Action);
        Assert.Equal("created", result.Results[2].Action);
    }

    [Fact]
    public async Task ImportRejectsAmbiguousCustomFieldNames()
    {
        var (_, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Ambiguous" }, null);
        await directory.Save(new CustomField { Name = "Notes", FieldType = "text" }, church.Id);
        await directory.Save(new CustomField { Name = "Notes", FieldType = "number" }, church.Id);

        var row = new MemberImportRow(null, "adult", "Ada", null, "Lovelace", null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null, null, null,
            new() { ["Notes"] = "VIP" });
        var result = await csv.Import(church.Id, [row], default);

        Assert.Equal(1, result.Failed);
        Assert.Contains("more than one", result.Results[0].Errors![0]);
    }

    [Fact]
    public async Task ImportRejectsBatchesOverRowLimit()
    {
        var (_, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "TooMany" }, null);
        var rows = Enumerable.Range(0, MemberCsvService.MaxImportRows + 1)
            .Select(_ => new MemberImportRow(null, "adult", "Ada", null, "Lovelace", null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, null, null, null, null))
            .ToArray();

        var error = await Assert.ThrowsAsync<ApiException>(() => csv.Import(church.Id, rows, default));
        Assert.Equal("too_many_rows", error.Code);
    }
}
