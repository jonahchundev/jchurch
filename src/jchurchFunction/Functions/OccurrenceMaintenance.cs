using JChurch.Services;
using JChurch.Storage;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace JChurch.Functions;

public sealed class OccurrenceMaintenance(Repositories repositories, EventService events, ILogger<OccurrenceMaintenance> logger)
{
    [Function("OccurrenceMaintenance")]
    public async Task Run([TimerTrigger("0 0 */6 * * *")] TimerInfo timer, CancellationToken cancellationToken)
    {
        string? churchToken = null;
        do
        {
            var churches = await repositories.Churches.Search(new Query { ContinuationToken = churchToken }, cancellationToken);
            foreach (var church in churches.Items)
            {
                string? eventToken = null;
                do
                {
                    var definitions = await repositories.Events.Search(new Query { ChurchId = church.Id, ContinuationToken = eventToken }, cancellationToken);
                    foreach (var definition in definitions.Items)
                    {
                        try { await events.Generate(church.Id, definition.Id, cancellationToken); }
                        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                        catch (Exception error) { logger.LogWarning("Occurrence generation failed with {ErrorType}; next run will retry.", error.GetType().Name); }
                    }
                    eventToken = definitions.ContinuationToken;
                } while (eventToken is not null);
            }
            churchToken = churches.ContinuationToken;
        } while (churchToken is not null);
    }
}