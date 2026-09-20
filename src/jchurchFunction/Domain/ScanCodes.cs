using System.Security.Cryptography;
using System.Text;

namespace JChurch.Domain;

public static class ScanCodes
{
    public static string Normalize(string? value)
    {
        if (value is null || value.Length > 128)
            throw new ApiException(400, "invalid_scan_code", "Use 8-64 letters, digits, or hyphens for the scan code.");
        var code = value.Trim();
        if (code.Length is < 8 or > 64 || !code.All(character => char.IsAsciiLetterOrDigit(character) || character == '-'))
            throw new ApiException(400, "invalid_scan_code", "Use 8-64 letters, digits, or hyphens for the scan code.");
        return code.ToUpperInvariant();
    }

    public static Member Normalize(Member member)
    {
        var code = member.ScanCode is null ? null : Normalize(member.ScanCode);
        if (code is not null && code.Equals(member.Id, StringComparison.OrdinalIgnoreCase))
            throw new ApiException(400, "invalid_scan_code", "The scan code must differ from the member ID.");
        var format = code is null ? null : member.ScanCodeFormat ?? "qr";
        if (format is not (null or "qr" or "code128"))
            throw new ApiException(400, "invalid_scan_format", "Choose QR or Code 128.");
        return member with { ScanCode = code, ScanCodeFormat = format };
    }

    public static string LookupId(string code) => "scan_" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Normalize(code)))).ToLowerInvariant();
    public static ApiException Conflict() => new(409, "scan_code_in_use", "This scan code is already assigned in this church.");
    public static ApiException NotFound() => new(404, "scan_code_not_found", "No matching member for this scan code.");
}

public sealed record ScanCodeLookup : Document
{
    public string MemberId { get; init; } = "";
}