using Azure.Identity;
using JChurch.Domain;
using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace JChurch;

public static class Configuration
{
    public static void ValidateSafety(IConfiguration configuration)
    {
        var environment = configuration["AZURE_FUNCTIONS_ENVIRONMENT"];
        if (environment is not ("Development" or "Test"))
            throw new InvalidOperationException("Authentication is deferred: only Development/Test with synthetic data is allowed.");
        if (configuration["Storage:Provider"] is not ("InMemory" or "CosmosDb"))
            throw new InvalidOperationException("Set Storage:Provider explicitly to InMemory or CosmosDb.");
    }

    public static IServiceCollection AddChurchServices(this IServiceCollection services, IConfiguration configuration)
    {
        ValidateSafety(configuration);
        if (configuration["Storage:Provider"] == "InMemory") services.AddSingleton(typeof(IRepository<>), typeof(InMemoryRepository<>));
        else
        {
            var endpoint = configuration["Cosmos:Endpoint"];
            var database = configuration["Cosmos:Database"];
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme != "https" || string.IsNullOrWhiteSpace(database))
                throw new InvalidOperationException("Cosmos:Endpoint (HTTPS) and Cosmos:Database are required.");
            services.AddSingleton(new CosmosSettings(endpoint!, database));
            services.AddSingleton(_ => new CosmosClient(endpoint, new DefaultAzureCredential(), new CosmosClientOptions
            {
                Serializer = new CosmosJsonSerializer(),
                MaxRetryAttemptsOnRateLimitedRequests = 5,
                MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(15),
                RequestTimeout = TimeSpan.FromSeconds(10)
            }));
            services.AddSingleton(typeof(IRepository<>), typeof(CosmosRepository<>));
        }
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<Repositories>();
        services.AddSingleton<DirectoryService>();
        services.AddSingleton<EventService>();
        services.AddSingleton<CheckInService>();
        return services;
    }
}