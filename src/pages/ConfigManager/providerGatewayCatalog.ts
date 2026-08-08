import { extractAvailableModelsFromGatewayResult } from '@/services/gateway/modelCatalog';

export interface ProviderGatewayCatalogModel {
  readonly id: string;
  readonly provider: string;
  readonly alias?: string;
  readonly supportsImage?: boolean;
}

/** 仅投影 Gateway 明确声明为当前可用的模型条目。 */
export function projectProviderGatewayCatalog(result: unknown): ProviderGatewayCatalogModel[] {
  return extractAvailableModelsFromGatewayResult(result)
    .map((model) => {
      const separatorIndex = model.id.indexOf('/');
      return {
        id: model.id,
        provider: separatorIndex > 0 ? model.id.slice(0, separatorIndex) : '',
        ...(model.alias ? { alias: model.alias } : {}),
        ...(typeof model.supportsImage === 'boolean'
          ? { supportsImage: model.supportsImage }
          : {}),
      };
    })
    .filter((model) => Boolean(model.provider));
}
