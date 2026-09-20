using System.Text.Json;
using System.Text.Json.Serialization;

namespace JChurch.Domain;

public abstract record Document
{
    public string Id { get; init; } = "";
    public string ChurchId { get; init; } = "";
    public string Kind => GetType().Name;
    [JsonPropertyName("_etag")]
    public string ETag { get; init; } = "";
    public bool Active { get; init; } = true;
    public string SearchText { get; init; } = "";
}

public sealed record Church : Document
{
    public string Name { get; init; } = "";
}

public sealed record Group : Document
{
    public string Name { get; init; } = "";
    public string? ParentGroupId { get; init; }
}

public sealed record Member : Document
{
    public string? ScanCode { get; init; }
    public string? ScanCodeFormat { get; init; }
    [JsonIgnore]
    public bool ScanCodeSpecified { get; init; }
    [JsonIgnore]
    public bool ScanCodeFormatSpecified { get; init; }
    public string FirstName { get; init; } = "";
    public string LastName { get; init; } = "";
    public string? MiddleName { get; init; }
    public DateOnly? BirthDate { get; init; }
    public string? School { get; init; }
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string[] GroupIds { get; init; } = [];
    public Dictionary<string, JsonElement> CustomFields { get; init; } = [];
}

public sealed record CustomField : Document
{
    public string Name { get; init; } = "";
    public string FieldType { get; init; } = "text";
}

public sealed record ChurchEvent : Document
{
    public string Name { get; init; } = "";
    public DateTime LocalStart { get; init; }
    public string TimeZone { get; init; } = "UTC";
    public int DurationMinutes { get; init; } = 60;
    public string? RecurrenceRule { get; init; }
}

public sealed record Occurrence : Document
{
    public string EventId { get; init; } = "";
    public DateTimeOffset StartsAt { get; init; }
    public DateTimeOffset EndsAt { get; init; }
    public bool Cancelled { get; init; }
    public bool Overridden { get; init; }
}

public sealed record Attendance : Document
{
    public string EventId { get; init; } = "";
    public string OccurrenceId { get; init; } = "";
    public string MemberId { get; init; } = "";
    public DateTimeOffset CheckedInAt { get; init; }
    public string[] GroupIds { get; init; } = [];
    public string[] InclusiveGroupIds { get; init; } = [];
}

public sealed class ApiException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters = { new UtcDateTimeConverter() }
    };

    public static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, Options), Options)!;
}

public sealed class UtcDateTimeConverter : JsonConverter<DateTimeOffset>
{
    public static string Format(DateTimeOffset value) => value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", System.Globalization.CultureInfo.InvariantCulture);
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => reader.GetDateTimeOffset().ToUniversalTime();
    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) => writer.WriteStringValue(Format(value));
}