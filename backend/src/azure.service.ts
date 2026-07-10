import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BlobServiceClient } from '@azure/storage-blob';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import * as appInsights from 'applicationinsights';

@Injectable()
export class AzureService implements OnModuleInit {
  private readonly logger = new Logger(AzureService.name);
  private blobServiceClient: BlobServiceClient | null = null;
  private searchClient: SearchClient<any> | null = null;
  private monitorClient: any = null;

  onModuleInit() {
    // 1. Initialize Azure Monitor (Application Insights)
    const instrumentationKey = process.env.APPINSIGHTS_INSTRUMENTATIONKEY || process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    if (instrumentationKey) {
      try {
        appInsights.setup(instrumentationKey).start();
        this.monitorClient = appInsights.defaultClient;
        this.logger.log('Azure Monitor (Application Insights) initialized successfully.');
      } catch (err) {
        this.logger.error('Failed to initialize Azure Monitor:', err);
      }
    }

    // 2. Initialize Azure Blob Storage Client
    const blobConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (blobConnectionString) {
      try {
        this.blobServiceClient = BlobServiceClient.fromConnectionString(blobConnectionString);
        this.logger.log('Azure Blob Storage client initialized successfully.');
      } catch (err) {
        this.logger.error('Failed to initialize Azure Blob Storage client:', err);
      }
    }

    // 3. Initialize Azure AI Search Client
    const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const searchKey = process.env.AZURE_SEARCH_KEY;
    const searchIndexName = process.env.AZURE_SEARCH_INDEX || 'woodflow-projects';
    if (searchEndpoint && searchKey) {
      try {
        this.searchClient = new SearchClient(
          searchEndpoint,
          searchIndexName,
          new AzureKeyCredential(searchKey)
        );
        this.logger.log('Azure AI Search client initialized successfully.');
      } catch (err) {
        this.logger.error('Failed to initialize Azure AI Search client:', err);
      }
    }
  }

  // Monitor Metric Logging
  trackMetric(name: string, value: number) {
    if (this.monitorClient) {
      this.monitorClient.trackMetric({ name, value });
    }
    this.logger.log(`[Metric] ${name}: ${value}`);
  }

  trackEvent(name: string, properties?: { [key: string]: string }) {
    if (this.monitorClient) {
      this.monitorClient.trackEvent({ name, properties });
    }
    this.logger.log(`[Event] ${name}: ${JSON.stringify(properties || {})}`);
  }

  // Blob Storage Methods
  async uploadFile(containerName: string, blobName: string, buffer: Buffer, mimeType: string): Promise<string> {
    if (!this.blobServiceClient) {
      this.logger.warn('Azure Blob Storage not configured. Saving local mock reference.');
      return `/uploads/${containerName}/${blobName}`;
    }

    const containerClient = this.blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists({ access: 'container' });

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType }
    });

    this.trackEvent('BlobUploaded', { containerName, blobName, mimeType });
    return blockBlobClient.url;
  }

  // AI Search Indexing Method
  async indexProject(projectData: {
    id: string;
    name: string;
    description?: string;
    tenantId: string;
    itemsCount: number;
    environments: string[];
    createdAt: string;
  }) {
    if (!this.searchClient) {
      this.logger.warn('Azure AI Search client not configured. Skipping indexing.');
      return;
    }

    try {
      await this.searchClient.uploadDocuments([
        {
          id: projectData.id,
          name: projectData.name,
          description: projectData.description || '',
          tenantId: projectData.tenantId,
          itemsCount: projectData.itemsCount,
          environments: projectData.environments,
          createdAt: projectData.createdAt,
        }
      ]);
      this.trackEvent('DocumentIndexed', { projectId: projectData.id });
      this.logger.log(`Project ${projectData.id} successfully indexed in Azure AI Search.`);
    } catch (err) {
      this.logger.error(`Failed to index project ${projectData.id} in Azure AI Search:`, err);
    }
  }
}
