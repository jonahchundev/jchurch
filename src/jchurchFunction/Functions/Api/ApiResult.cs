namespace JChurch.Functions.Api;

internal sealed record ApiResult(int Status, object? Body = null, string? Location = null, bool RawText = false, byte[]? Bytes = null, string? ContentType = null, string? CacheControl = null);
