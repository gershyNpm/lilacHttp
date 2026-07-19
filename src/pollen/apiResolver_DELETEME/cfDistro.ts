import type { Soil } from '@gershy/lilac';
import type { ApiResolver } from './base.ts';
import { CloudFrontClient, ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { HttpCaller } from '../httpCaller.ts';

// TODO: ZZZ deleeteeeeeee
export class ApiResolverCfDistro implements ApiResolver {
  protected cfDistroName: string;
  constructor(cfDistroName: string /* resolved name - like `${context.pfx}-gateway` */) {
    this.cfDistroName = cfDistroName;
  }
  public async resolveApi(soil: Soil.Base) {
    
    // Query CloudFront to get distribution domain
    const client = new CloudFrontClient(soil.getAwsClientConfig());
    
    // List all CloudFront distributions
    const { cfDistroName } = this;
    const { DistributionList } = await client.send(new ListDistributionsCommand({}));
    const distros = DistributionList?.Items ?? [];
    const testDistro = distros.find(d => d.Comment === cfDistroName);
    if (!testDistro) throw Error('test distribution missing')[cl.mod]({ cfDistroName, distros });
    
    return new HttpCaller({
      context: {
        progressiveServiceMap: {
          [`cfDistro/${cfDistroName}`]: { addr: testDistro.DomainName!, port: 443 }
        }
      },
      serviceId: `cfDistro/${cfDistroName}`
    });
    
  }
};