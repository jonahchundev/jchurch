targetScope = 'resourceGroup'

@description('Only synthetic-data development/test environments are supported.')
@allowed(['dev', 'test'])
param environment string = 'dev'

@description('Choose a region supporting Linux Flex Consumption and .NET 10.')
param location string = resourceGroup().location

var suffix = uniqueString(resourceGroup().id, environment)
var tags = { application: 'jchurch', environment: environment, dataClassification: 'synthetic-only' }

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'jc${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Enabled'
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: { deleteRetentionPolicy: { enabled: true, days: 7 } }
}

resource deployments 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'deployments'
  properties: { publicAccess: 'None' }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: 'cosmos-jchurch-${suffix}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [{ locationName: location, failoverPriority: 0 }]
    enableFreeTier: true
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    publicNetworkAccess: 'Enabled'
    isVirtualNetworkFilterEnabled: false
    disableLocalAuth: true
    minimalTlsVersion: 'Tls12'
    backupPolicy: { type: 'Continuous', continuousModeProperties: { tier: 'Continuous7Days' } }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: 'jchurch'
  properties: {
    resource: { id: 'jchurch' }
    options: { throughput: 1000 } // shared across containers, covered by free tier
  }
}

resource directory 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'directory'
  properties: {
    resource: {
      id: 'directory'
      partitionKey: { paths: ['/churchId'], kind: 'Hash', version: 2 }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [for path in ['/churchId/?', '/kind/?', '/active/?', '/searchText/?', '/parentGroupId/?', '/groupIds/[]/?', '/eventId/?', '/startsAt/?']: { path: path }]
        excludedPaths: [{ path: '/*' }]
      }
    }
  }
}

resource attendance 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'attendance'
  properties: {
    resource: {
      id: 'attendance'
      partitionKey: { paths: ['/churchId', '/occurrenceId'], kind: 'MultiHash', version: 2 }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [for path in ['/churchId/?', '/kind/?', '/active/?', '/occurrenceId/?', '/eventId/?', '/memberId/?', '/checkedInAt/?', '/groupIds/[]/?', '/inclusiveGroupIds/[]/?']: { path: path }]
        excludedPaths: [{ path: '/*' }]
      }
    }
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-jchurch-${environment}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: 'func-jchurch-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    enabled: true
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}deployments'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }
      runtime: { name: 'dotnet-isolated', version: '10.0' }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'AZURE_FUNCTIONS_ENVIRONMENT', value: 'Development' }
        { name: 'Storage__Provider', value: 'CosmosDb' }
        { name: 'Cosmos__Endpoint', value: cosmos.properties.documentEndpoint }
        { name: 'Cosmos__Database', value: database.name }
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__blobServiceUri', value: storage.properties.primaryEndpoints.blob }
        { name: 'AzureWebJobsStorage__queueServiceUri', value: storage.properties.primaryEndpoints.queue }
        { name: 'AzureWebJobsStorage__tableServiceUri', value: storage.properties.primaryEndpoints.table }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobs.OccurrenceMaintenance.Disabled', value: 'false' }
      ]
    }
  }
}

resource web 'Microsoft.Web/staticSites@2022-09-01' = {
  name: 'swa-jchurch-${environment}-${suffix}'
  location: 'eastus2'
  tags: tags
  sku: { name: 'Free' }
  properties: {
    stagingEnvironmentPolicy: 'Disabled'
  }
}

resource cosmosAccess 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, app.id, 'data-contributor')
  properties: {
    principalId: app.identity.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: '${cosmos.id}/dbs/${database.name}'
  }
}

var storageRoles = [
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
]

resource storageAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in storageRoles: {
  name: guid(storage.id, app.id, role)
  scope: storage
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role)
  }
}]

output functionAppName string = app.name
output webAppName string = web.name
output webAppHostname string = web.properties.defaultHostname
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output databaseName string = database.name
output deploymentBlocked bool = true
