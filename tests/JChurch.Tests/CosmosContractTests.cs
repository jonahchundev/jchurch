using Azure.Identity;
using JChurch.Domain;
using JChurch.Storage;
using Microsoft.Azure.Cosmos;
using Xunit;

namespace JChurch.Tests;

public sealed class CosmosFactAttribute : FactAttribute
{
    public CosmosFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("JCHURCH_RUN_COSMOS_TESTS") != "true")
            Skip = "Opt-in integration test: requires a pre-provisioned synthetic-data database and Cosmos data-plane access.";
    }
}

public sealed class CosmosContractTests
{
    [Fact]
    public Task InMemoryPassesSharedContract() => RepositoryContract.Run(new InMemoryRepository<Member>(), new InMemoryRepository<Attendance>());

    [CosmosFact]
    [Trait("Category", "CosmosIntegration")]
    public async Task CosmosPassesSharedContract()
    {
        var endpoint = Environment.GetEnvironmentVariable("JCHURCH_COSMOS_ENDPOINT") ?? throw new InvalidOperationException("Set JCHURCH_COSMOS_ENDPOINT.");
        var databaseName = Environment.GetEnvironmentVariable("JCHURCH_COSMOS_DATABASE") ?? throw new InvalidOperationException("Set JCHURCH_COSMOS_DATABASE to a dedicated synthetic-data test database.");
        using var client = new CosmosClient(endpoint, new DefaultAzureCredential(), new CosmosClientOptions { Serializer = new CosmosJsonSerializer() });
        var database = client.GetDatabase(databaseName);
        var church = $"contract_{Guid.NewGuid():N}";
        var otherChurch = $"contract_{Guid.NewGuid():N}";
        try
        {
            var settings = new CosmosSettings(endpoint, databaseName);
            await RepositoryContract.Run(new CosmosRepository<Member>(client, settings), new CosmosRepository<Attendance>(client, settings), church, otherChurch);
        }
        finally
        {
            foreach (var code in new[] { "contract-old", "contract-new" })
                await DeleteIfPresent(database.GetContainer("directory"), ScanCodes.LookupId(code), new PartitionKey(church));
            foreach (var memberId in new[] { "member_a", "member_b", "member_c" })
                await DeleteIfPresent(database.GetContainer("directory"), memberId, new PartitionKey(church));
            foreach (var churchId in new[] { church, otherChurch })
                await DeleteIfPresent(database.GetContainer("attendance"), "occurrence_member_a", new PartitionKeyBuilder().Add(churchId).Add("occurrence").Build());
        }
    }

    private static async Task DeleteIfPresent(Container container, string id, PartitionKey partitionKey)
    {
        try { await container.DeleteItemAsync<object>(id, partitionKey); }
        catch (CosmosException error) when (error.StatusCode == System.Net.HttpStatusCode.NotFound) { }
    }
}