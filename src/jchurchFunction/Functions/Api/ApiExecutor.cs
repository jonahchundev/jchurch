using System.Globalization;
using System.Net;
using System.Text.Json;
using JChurch.Domain;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions.Api;

internal static class ApiExecutor
{
    internal static async Task<HttpResponseData> Execute(HttpRequestData request, FunctionContext context, ILogger logger, Func<CancellationToken, Task<ApiResult>> handler, CancellationToken cancellationToken)
    {
        try
        {
            var result = await handler(cancellationToken);
            var response = request.CreateResponse((HttpStatusCode)result.Status);
            response.Headers.Add("Cache-Control", result.CacheControl ?? "no-store");
            if (result.Body is Document document) response.Headers.Add("ETag", document.ETag);
            if (result.Location is not null) response.Headers.Add("Location", result.Location);
            if (result.RawText && result.Body is string text)
            {
                response.Headers.Add("Content-Type", "text/csv; charset=utf-8");
                await response.WriteStringAsync(text, cancellationToken);
            }
            else if (result.Bytes is not null)
            {
                response.Headers.Add("Content-Type", result.ContentType ?? "application/octet-stream");
                await response.Body.WriteAsync(result.Bytes, cancellationToken);
            }
            else if (result.Body is not null)
            {
                response.Headers.Add("Content-Type", "application/json; charset=utf-8");
                await JsonSerializer.SerializeAsync(response.Body, result.Body, result.Body.GetType(), Json.Options, cancellationToken);
            }
            return response;
        }
        catch (ApiException error) { return await Problem(request, error.Status, error.Code, error.Message, context.InvocationId, cancellationToken); }
        catch (JsonException) { return await Problem(request, 400, "invalid_json", "Request body contains invalid JSON or unsupported fields.", context.InvocationId, cancellationToken); }
        catch (CosmosException error)
        {
            var status = error.StatusCode == HttpStatusCode.TooManyRequests ? 429 : 503;
            var response = await Problem(request, status, "storage_unavailable", "Storage could not confirm the operation. Retry the request.", context.InvocationId, cancellationToken);
            response.Headers.Add("Retry-After", Math.Max(1, (int)Math.Ceiling(error.RetryAfter?.TotalSeconds ?? 1)).ToString(CultureInfo.InvariantCulture));
            logger.LogWarning("Storage failure with status {Status}; invocation {InvocationId}", (int)error.StatusCode, context.InvocationId);
            return response;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            logger.LogError("Unhandled {ErrorType}; invocation {InvocationId}", error.GetType().Name, context.InvocationId);
            return await Problem(request, 503, "unavailable", "The operation could not be confirmed. Retry the request.", context.InvocationId, cancellationToken);
        }
    }

    internal static async Task<HttpResponseData> Problem(HttpRequestData request, int status, string code, string detail, string traceId, CancellationToken cancellationToken)
    {
        var response = request.CreateResponse((HttpStatusCode)status);
        response.Headers.Add("Content-Type", "application/problem+json");
        response.Headers.Add("Cache-Control", "no-store");
        if (code == "scan_rate_limit") response.Headers.Add("Retry-After", "60");
        await JsonSerializer.SerializeAsync(response.Body, new { type = $"urn:jchurch:error:{code}", title = code, status, detail, traceId }, Json.Options, cancellationToken);
        return response;
    }
}
