import type { Soil } from '@gershy/lilac';
import type { ApiResolver } from './base.ts';
import { ApiGatewayV2Client, GetApisCommand, GetStagesCommand } from '@aws-sdk/client-apigatewayv2';
import { HttpCaller } from '../httpCaller.ts';

// TODO: ZZZ deleteeee
export class ApiResolverHttpGateway implements ApiResolver {
  protected apiGwName: string;
  constructor(apiGwName: string /* resolved name - like `${context.pfx}-gateway` */) {
    this.apiGwName = apiGwName;
  }
  public async resolveApi(soil: Soil.Base) {
    
    // Query API Gateway v2 to validate infrastructure
    const client = new ApiGatewayV2Client(soil.getAwsClientConfig());
    
    // List all API Gateway v2 APIs
    const { apiGwName } = this;
    const { Items: apis = [] } = await client.send(new GetApisCommand({}));
    const testApi = apis.find(api => api.Name === apiGwName);
    if (!testApi) throw Error('test api missing')[cl.mod]({ apiGwName, apis });
    
    const apiId = testApi.ApiId;
    const { Items: stages = [] } = await client.send(new GetStagesCommand({  ApiId: apiId }));
    if (!stages.length) throw Error('test stage missing')[cl.mod]({ stages, id: apiId });
    const stage = stages[0];
    
    return new HttpCaller({
      context: {
        progressiveServiceMap: {
          [`apiGw/${soil.getRegion()}/${apiGwName}`]: {
            addr: `${apiId}.execute-api.${soil.getRegion()}.amazonaws.com`,
            port: 443,
            http: { path: [ stage.StageName! ] }
          }
        }
      },
      serviceId: `apiGw/${soil.getRegion()}/${apiGwName}`,
    });
    
  }
};
