using System.Collections.Concurrent;
using Azure;
using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace JChurch.Storage;

public sealed record MemberImage(byte[] Content, string ContentType);

public interface IMemberImageStore
{
    Task Put(string churchId, string memberId, string contentType, byte[] content, CancellationToken cancellationToken = default);
    Task<MemberImage?> Get(string churchId, string memberId, CancellationToken cancellationToken = default);
    Task Delete(string churchId, string memberId, CancellationToken cancellationToken = default);
}

public sealed class InMemoryMemberImageStore : IMemberImageStore
{
    private readonly ConcurrentDictionary<(string ChurchId, string MemberId), MemberImage> images = new();

    public Task Put(string churchId, string memberId, string contentType, byte[] content, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        images[(churchId, memberId)] = new MemberImage(content.ToArray(), contentType);
        return Task.CompletedTask;
    }

    public Task<MemberImage?> Get(string churchId, string memberId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        images.TryGetValue((churchId, memberId), out var image);
        return Task.FromResult(image is null ? null : new MemberImage(image.Content.ToArray(), image.ContentType));
    }

    public Task Delete(string churchId, string memberId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        images.TryRemove((churchId, memberId), out _);
        return Task.CompletedTask;
    }
}

public sealed class BlobMemberImageStore : IMemberImageStore
{
    public const string ContainerName = "member-images";

    private readonly BlobContainerClient container;
    private int containerReady;

    // Connection string supports Azurite/local development; HTTPS URI uses the function app's managed identity.
    public BlobMemberImageStore(string? connectionString, string? serviceUri)
    {
        if (!string.IsNullOrWhiteSpace(connectionString))
            container = new BlobContainerClient(connectionString, ContainerName);
        else if (Uri.TryCreate(serviceUri, UriKind.Absolute, out var uri) && uri.Scheme == "https")
            container = new BlobContainerClient(new Uri($"{serviceUri!.TrimEnd('/')}/{ContainerName}"), new DefaultAzureCredential());
        else
            throw new InvalidOperationException("Images:ConnectionString or Images:BlobServiceUri (HTTPS) is required when Storage:Provider is CosmosDb.");
    }

    private async Task<BlobClient> Blob(string churchId, string memberId, CancellationToken cancellationToken)
    {
        if (Interlocked.CompareExchange(ref containerReady, 1, 0) == 0)
            await container.CreateIfNotExistsAsync(cancellationToken: cancellationToken);
        return container.GetBlobClient($"{churchId}/{memberId}");
    }

    public async Task Put(string churchId, string memberId, string contentType, byte[] content, CancellationToken cancellationToken = default)
    {
        var blob = await Blob(churchId, memberId, cancellationToken);
        await blob.UploadAsync(new BinaryData(content), new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = contentType }
        }, cancellationToken);
    }

    public async Task<MemberImage?> Get(string churchId, string memberId, CancellationToken cancellationToken = default)
    {
        try
        {
            var blob = await Blob(churchId, memberId, cancellationToken);
            var download = await blob.DownloadStreamingAsync(cancellationToken: cancellationToken);
            using var buffer = new MemoryStream();
            await download.Value.Content.CopyToAsync(buffer, cancellationToken);
            return new MemberImage(buffer.ToArray(), download.Value.Details.ContentType);
        }
        catch (RequestFailedException error) when (error.Status == 404)
        {
            return null;
        }
    }

    public async Task Delete(string churchId, string memberId, CancellationToken cancellationToken = default)
    {
        try
        {
            var blob = await Blob(churchId, memberId, cancellationToken);
            await blob.DeleteIfExistsAsync(cancellationToken: cancellationToken);
        }
        catch (RequestFailedException error) when (error.Status == 404)
        {
            // Container or blob already gone; delete is idempotent.
        }
    }
}
