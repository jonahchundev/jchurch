using System.Text.Json;
using Azure.Core;
using JChurch.Domain;
using JChurch.Storage;
using Microsoft.Azure.Cosmos;
using Xunit;

namespace JChurch.Tests;

public sealed class AttendanceTransferSerializationTests
{
    private sealed class PayloadCapturedException : Exception;

    private sealed class NoNetworkCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("This test must never authenticate or contact Cosmos.");
        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("This test must never authenticate or contact Cosmos.");
    }

    private sealed class CapturingSerializer : CosmosSerializer
    {
        private readonly CosmosJsonSerializer serializer = new();
        public JsonElement Payload { get; private set; }
        public Type? PayloadType { get; private set; }

        public override T FromStream<T>(Stream stream) => serializer.FromStream<T>(stream);

        public override Stream ToStream<T>(T input)
        {
            using var stream = serializer.ToStream(input);
            using var json = JsonDocument.Parse(stream);
            Payload = json.RootElement.Clone();
            PayloadType = typeof(T);
            throw new PayloadCapturedException();
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("\"inactive-keeper\"")]
    public async Task TransferBatchPreservesAttendanceFieldsBeforeNetworkAccess(string? keeperEtag)
    {
        var serializer = new CapturingSerializer();
        const string endpoint = "https://unused.invalid:443/";
        using var client = new CosmosClient(endpoint, new NoNetworkCredential(), new CosmosClientOptions { Serializer = serializer });
        var now = DateTimeOffset.Parse("2026-11-16T10:00:00Z");
        var checkedIn = now.AddYears(-1);
        var repository = new CosmosRepository<Attendance>(client, new CosmosSettings(endpoint, "synthetic"), new TestClock(now));
        var receipt = new Attendance
        {
            Id = "occurrence_keeper", ChurchId = "church", OccurrenceId = "occurrence", MemberId = "keeper",
            EventId = "event", CheckedInAt = checkedIn, GroupIds = ["group"], InclusiveGroupIds = ["parent", "group"],
            Audit = [new AttendanceAuditEntry { Action = "merged-from duplicate", OccurredAt = now }]
        };

        await Assert.ThrowsAsync<PayloadCapturedException>(() => repository.Transfer("church", "occurrence_duplicate", "\"source\"", receipt, keeperEtag));

        var payload = serializer.Payload;
        Assert.True(payload.TryGetProperty("occurrenceId", out var occurrence), "Transfer payload lost the attendance partition key.");
        Assert.Equal("occurrence", occurrence.GetString());
        Assert.Equal(typeof(Attendance), serializer.PayloadType);
        Assert.Equal("church", payload.GetProperty("churchId").GetString());
        Assert.Equal("occurrence_keeper", payload.GetProperty("id").GetString());
        Assert.Equal("Attendance", payload.GetProperty("kind").GetString());
        Assert.Equal("keeper", payload.GetProperty("memberId").GetString());
        Assert.Equal("event", payload.GetProperty("eventId").GetString());
        Assert.Equal(checkedIn, payload.GetProperty("checkedInAt").GetDateTimeOffset());
        Assert.Equal(now, payload.GetProperty("createdOn").GetDateTimeOffset());
        Assert.Equal(now, payload.GetProperty("updatedOn").GetDateTimeOffset());
        Assert.True(payload.GetProperty("active").GetBoolean());
        Assert.Equal(["group"], payload.GetProperty("groupIds").EnumerateArray().Select(item => item.GetString()));
        Assert.Equal(["parent", "group"], payload.GetProperty("inclusiveGroupIds").EnumerateArray().Select(item => item.GetString()));
        Assert.Equal("merged-from duplicate", payload.GetProperty("audit")[0].GetProperty("action").GetString());
    }
}