using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Xunit;

namespace JChurch.Tests;

public sealed class GroupCsvServiceTests
{
    private static (Repositories Repositories, DirectoryService Directory, GroupCsvService Csv) Setup()
    {
        var repositories = ServiceTests.Memory();
        var directory = new DirectoryService(repositories, TimeProvider.System);
        return (repositories, directory, new GroupCsvService(repositories, directory));
    }

    [Fact]
    public void TemplateHasFixedColumnsOnly()
    {
        var (_, _, csv) = Setup();
        var template = csv.ImportTemplate();
        var lines = template.TrimEnd('\n', '\r').Split('\n');
        Assert.Single(lines);
        Assert.Equal("Id,Name,ParentName", lines[0].TrimEnd('\r'));
    }

    [Fact]
    public async Task ExportOrdersTopLevelGroupsBeforeChildren()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Export" }, null);
        var parent = await directory.Save(new Group { Name = "Youth" }, church.Id);
        var child = await directory.Save(new Group { Name = "Choir", ParentGroupId = parent.Id }, church.Id);

        var text = await csv.ExportCsv(church.Id, default);
        var lines = text.TrimEnd('\n', '\r').Split('\n');

        Assert.Equal(3, lines.Length);
        Assert.Contains($"{parent.Id},Youth,", lines[1]);
        Assert.Equal($"{child.Id},Choir,Youth", lines[2].TrimEnd('\r'));
    }

    [Fact]
    public async Task ImportCreatesTopLevelAndChildInSameBatch()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Import" }, null);

        var parentRow = new GroupImportRow(null, "Youth", null);
        var childRow = new GroupImportRow(null, "Choir", "Youth");
        var result = await csv.Import(church.Id, [parentRow, childRow], default);

        Assert.Equal(2, result.Created);
        Assert.Equal(0, result.Failed);
        var groups = (await repositories.Groups.Search(new Query { ChurchId = church.Id })).Items;
        var parent = Assert.Single(groups, group => group.Name == "Youth");
        var child = Assert.Single(groups, group => group.Name == "Choir");
        Assert.Null(parent.ParentGroupId);
        Assert.Equal(parent.Id, child.ParentGroupId);
    }

    [Fact]
    public async Task ImportUpdatesExistingGroupById()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Update" }, null);
        var group = await directory.Save(new Group { Name = "Youth" }, church.Id);

        var row = new GroupImportRow(group.Id, "Young Adults", null);
        var result = await csv.Import(church.Id, [row], default);

        Assert.Equal(0, result.Created);
        Assert.Equal(1, result.Updated);
        var updated = await repositories.Groups.Get(church.Id, group.Id);
        Assert.Equal("Young Adults", updated!.Name);
    }

    [Fact]
    public async Task ImportRejectsUnknownParentNameAsRowError()
    {
        var (_, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Unknown parent" }, null);

        var row = new GroupImportRow(null, "Choir", "NoSuchGroup");
        var result = await csv.Import(church.Id, [row], default);

        Assert.Equal(1, result.Failed);
        Assert.Equal("error", result.Results[0].Action);
        Assert.Contains("No active top-level group", result.Results[0].Errors![0]);
    }

    [Fact]
    public async Task ImportRejectsAmbiguousParentName()
    {
        var (_, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Ambiguous" }, null);
        await directory.Save(new Group { Name = "Youth" }, church.Id);
        await directory.Save(new Group { Name = "Youth" }, church.Id);

        var row = new GroupImportRow(null, "Choir", "Youth");
        var result = await csv.Import(church.Id, [row], default);

        Assert.Equal(1, result.Failed);
        Assert.Contains("more than one", result.Results[0].Errors![0]);
    }

    [Fact]
    public async Task ImportRejectsChangingParentOnUpdate()
    {
        var (_, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Reparent" }, null);
        var first = await directory.Save(new Group { Name = "First" }, church.Id);
        var second = await directory.Save(new Group { Name = "Second" }, church.Id);
        var child = await directory.Save(new Group { Name = "Child", ParentGroupId = first.Id }, church.Id);

        var row = new GroupImportRow(child.Id, "Child", second.Name);
        var result = await csv.Import(church.Id, [row], default);

        Assert.Equal(1, result.Failed);
        Assert.Contains("immutable", result.Results[0].Errors![0]);
    }

    [Fact]
    public async Task ImportRejectsBatchesOverRowLimit()
    {
        var (_, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "TooMany" }, null);
        var rows = Enumerable.Range(0, GroupCsvService.MaxImportRows + 1)
            .Select(index => new GroupImportRow(null, $"Group {index}", null))
            .ToArray();

        var error = await Assert.ThrowsAsync<ApiException>(() => csv.Import(church.Id, rows, default));
        Assert.Equal("too_many_rows", error.Code);
    }

    [Fact]
    public async Task ImportReportsPerRowErrorsAndContinues()
    {
        var (_, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Errors" }, null);

        var badParent = new GroupImportRow(null, "Choir", "NoSuchGroup");
        var good = new GroupImportRow(null, "Youth", null);
        var result = await csv.Import(church.Id, [badParent, good], default);

        Assert.Equal(1, result.Created);
        Assert.Equal(1, result.Failed);
        Assert.Equal("error", result.Results[0].Action);
        Assert.Equal("created", result.Results[1].Action);
    }

    [Fact]
    public async Task ImportResolvesChildAgainstAnUpdatedPreexistingParentInTheSameBatch()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Update then reference" }, null);
        var parent = await directory.Save(new Group { Name = "JAHFAM" }, church.Id);

        var updateParent = new GroupImportRow(parent.Id, "JAHFAM", null);
        var child = new GroupImportRow(null, "6th Grade A", "JAHFAM");
        var result = await csv.Import(church.Id, [updateParent, child], default);

        Assert.Equal(0, result.Failed);
        Assert.Equal(1, result.Updated);
        Assert.Equal(1, result.Created);
        var groups = (await repositories.Groups.Search(new Query { ChurchId = church.Id })).Items;
        var createdChild = Assert.Single(groups, group => group.Name == "6th Grade A");
        Assert.Equal(parent.Id, createdChild.ParentGroupId);
    }

    [Fact]
    public async Task ImportAllowsRenamingAndReferencingTheNewNameInTheSameBatch()
    {
        var (repositories, directory, csv) = Setup();
        var church = await directory.Save(new Church { Name = "Rename then reference" }, null);
        var parent = await directory.Save(new Group { Name = "Old Name" }, church.Id);

        var rename = new GroupImportRow(parent.Id, "New Name", null);
        var child = new GroupImportRow(null, "Child", "New Name");
        var result = await csv.Import(church.Id, [rename, child], default);

        Assert.Equal(0, result.Failed);
        var groups = (await repositories.Groups.Search(new Query { ChurchId = church.Id })).Items;
        var createdChild = Assert.Single(groups, group => group.Name == "Child");
        Assert.Equal(parent.Id, createdChild.ParentGroupId);
    }
}
