targetScope = 'resourceGroup'

@description('Only synthetic-data development/test environments are supported.')
@allowed(['dev', 'test'])
param environment string = 'dev'

@description('Choose a region supporting Linux Flex Consumption and .NET 10.')
param location string = resourceGroup().location

var suffix = uniqueString(resourceGroup().id, environment)
var tags = { application: 'jchurch', environment: environment, dataClassification: 'synthetic-only' }

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-jchurch-${environment}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.86.0.0/16'] }
    subnets: [
      {
        name: 'functions'
        properties: {
          addressPrefix: '10.86.0.0/24'
          delegations: [{ name: 'flex', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'private-endpoints'
        properties: { addressPrefix: '10.86.1.0/24', privateEndpointNetworkPolicies: 'Disabled' }
      }
    ]
  }
}

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
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'None' }
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
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true
    minimalTlsVersion: 'Tls12'
    backupPolicy: { type: 'Continuous', continuousModeProperties: { tier: 'Continuous7Days' } }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: 'jchurch'
  properties: { resource: { id: 'jchurch' } }
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
        includedPaths: [for path in ['/id/?', '/churchId/?', '/kind/?', '/active/?', '/searchText/?', '/parentGroupId/?', '/groupIds/[]/?', '/eventId/?', '/startsAt/?']: { path: path }]
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
        includedPaths: [for path in ['/id/?', '/churchId/?', '/kind/?', '/active/?', '/occurrenceId/?', '/eventId/?', '/memberId/?', '/checkedInAt/?', '/groupIds/[]/?', '/inclusiveGroupIds/[]/?']: { path: path }]
        excludedPaths: [{ path: '/*' }]
      }
    }
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'logs-jchurch-${environment}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-jchurch-${environment}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    DisableLocalAuth: true
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
    enabled: false
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Disabled'
    virtualNetworkSubnetId: '${network.id}/subnets/functions'
    functionAppConfig: {
      runtime: { name: 'dotnet-isolated', version: '10.0' }
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deployments.name}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
        triggers: { http: { perInstanceConcurrency: 16 } }
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'AZURE_FUNCTIONS_ENVIRONMENT', value: 'Development' }
        { name: 'Storage__Provider', value: 'CosmosDb' }
        { name: 'Cosmos__Endpoint', value: cosmos.properties.documentEndpoint }
        { name: 'Cosmos__Database', value: database.name }
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobs.OccurrenceMaintenance.Disabled', value: 'false' }
      ]
    }
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

var privateServices = [
  { name: 'blob', resourceId: storage.id, groupId: 'blob', zone: 'privatelink.blob.${az.environment().suffixes.storage}' }
  { name: 'queue', resourceId: storage.id, groupId: 'queue', zone: 'privatelink.queue.${az.environment().suffixes.storage}' }
  { name: 'table', resourceId: storage.id, groupId: 'table', zone: 'privatelink.table.${az.environment().suffixes.storage}' }
  { name: 'cosmos', resourceId: cosmos.id, groupId: 'Sql', zone: 'privatelink.documents.azure.com' }
  { name: 'functions', resourceId: app.id, groupId: 'sites', zone: 'privatelink.azurewebsites.net' }
]

resource zones 'Microsoft.Network/privateDnsZones@2024-06-01' = [for service in privateServices: {
  name: service.zone
  location: 'global'
  tags: tags
}]

resource links 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [for (service, index) in privateServices: {
  parent: zones[index]
  name: 'jchurch-link'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: network.id } }
}]

resource endpoints 'Microsoft.Network/privateEndpoints@2024-05-01' = [for service in privateServices: {
  name: 'pe-jchurch-${service.name}'
  location: location
  tags: tags
  properties: {
    subnet: { id: '${network.id}/subnets/private-endpoints' }
    privateLinkServiceConnections: [{
      name: service.name
      properties: { privateLinkServiceId: service.resourceId, groupIds: [service.groupId] }
    }]
  }
}]

resource zoneGroups 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = [for (service, index) in privateServices: {
  parent: endpoints[index]
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: service.name, properties: { privateDnsZoneId: zones[index].id } }] }
}]

output functionAppName string = app.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output databaseName string = database.name
output monitoringResourceId string = insights.id
output deploymentBlocked bool = true
