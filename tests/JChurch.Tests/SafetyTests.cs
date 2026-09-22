using System.Text;
using JChurch.Domain;
using JChurch.Storage;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace JChurch.Tests;

public sealed class SafetyTests
{
    [Theory]
    [InlineData("Production", "InMemory", null)]
    [InlineData("Production", "CosmosDb", null)]
    [InlineData("Development", "Typo", null)]
    public void UnsafeEnvironmentsAreRejected(string environment, string provider, string? site)
    {
        var settings = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AZURE_FUNCTIONS_ENVIRONMENT"] = environment, ["Storage:Provider"] = provider, ["WEBSITE_SITE_NAME"] = site
        }).Build();
        Assert.Throws<InvalidOperationException>(() => Configuration.ValidateSafety(settings));
    }

    [Fact]
    public void CosmosPointReadsRejectWrongDocumentTypes()
    {
        var serializer = new CosmosJsonSerializer();
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("{\"id\":\"member\",\"churchId\":\"church\",\"kind\":\"Member\",\"_rid\":\"system\"}"));
        Assert.Equal(404, Assert.Throws<ApiException>(() => serializer.FromStream<Group>(stream)).Status);
    }

    [Fact]
    public async Task ChurchDiscoveryCanEnumerateMultiplePartitions()
    {
        var repository = new InMemoryRepository<Church>();
        await repository.Create(new Church { Id = "first", ChurchId = "first" });
        await repository.Create(new Church { Id = "second", ChurchId = "second" });
        Assert.Equal(2, (await repository.Search(new Query())).Items.Count);
        Assert.Single((await repository.Search(new Query { ChurchId = "first" })).Items);
    }
}