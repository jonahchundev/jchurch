// using Azure.Monitor.OpenTelemetry.Exporter;
// using Microsoft.Azure.Functions.Worker;
// using Microsoft.Azure.Functions.Worker.Builder;
// using Microsoft.Azure.Functions.Worker.OpenTelemetry;
// using Microsoft.Extensions.DependencyInjection;
// using Microsoft.Extensions.Hosting;
// using OpenTelemetry;

// var builder = FunctionsApplication.CreateBuilder(args);

// builder.ConfigureFunctionsWebApplication();

// // if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("APPLICATIONINSIGHTS_CONNECTION_STRING")))
// // {
// //     builder.Services.AddOpenTelemetry()
// //         .UseFunctionsWorkerDefaults()
// //         .UseAzureMonitorExporter();
// // }

// builder.Build().Run();

//using JChurch;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.Hosting;

var builder = FunctionsApplication.CreateBuilder(args);
//builder.Services.AddChurchServices(builder.Configuration);
builder.Build().Run();
