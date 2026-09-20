using JChurch.Functions;
using Xunit;

namespace JChurch.Tests;

public sealed class SwaggerUiTests
{
    [Theory]
    [InlineData(null, "text/html")]
    [InlineData("", "text/html")]
    [InlineData("index.html", "text/html")]
    [InlineData("swagger-ui.css", "text/css")]
    [InlineData("swagger-ui-bundle.js", "text/javascript")]
    [InlineData("swagger-initializer.js", "text/javascript")]
    [InlineData("favicon-32x32.png", "image/png")]
    public void ServesPackagedAssets(string? asset, string contentType)
    {
        var result = SwaggerUi.OpenAsset(asset);
        Assert.NotNull(result);
        using var content = result.Value.Content;
        Assert.StartsWith(contentType, result.Value.ContentType);
        Assert.NotEqual(-1, content.ReadByte());
    }

    [Theory]
    [InlineData("swagger-ui-bundle.js", "SwaggerUIBundle")]
    [InlineData("swagger-ui.css", ".swagger-ui")]
    public void CompressedPackageAssetsAreDecoded(string asset, string expected)
    {
        using var content = SwaggerUi.OpenAsset(asset)!.Value.Content;
        using var reader = new StreamReader(content);
        Assert.Contains(expected, reader.ReadToEnd());
    }

    [Theory]
    [InlineData("../local.settings.json")]
    [InlineData("openapi.json")]
    [InlineData("missing.js")]
    public void OnlyKnownAssetsAreExposed(string asset) => Assert.Null(SwaggerUi.OpenAsset(asset));

    [Fact]
    public void UsesLocalSpecificationWithoutExternalValidator()
    {
        using var content = SwaggerUi.OpenAsset("swagger-initializer.js")!.Value.Content;
        using var reader = new StreamReader(content);
        var script = reader.ReadToEnd();
        Assert.Contains("url: '/api/v1/openapi.json'", script);
        Assert.Contains("validatorUrl: null", script);
        Assert.DoesNotContain("https://", script);
    }
}