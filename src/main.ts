import '@gershy/clearing';

import { Flower, PetalTerraform, Soil, type Context as LilacContext } from '@gershy/lilac';
import { Domain } from '@gershy/lilac-domain';
import type { HttpReq } from '@gershy/util-http';
import { LambdaHttp } from '@gershy/lilac-lambda-http';
import * as aws from './util/aws.ts';
import * as tf from './util/terraform.ts';
import awsRegions from './util/awsRegions.ts';
import { LambdaEdge } from './lambdaEdge/main.ts';
import phrasing from '@gershy/util-phrasing';
import { HttpCaller } from './pollen/httpCaller.ts';
import { SoktScript } from './pollen/soktScript.ts';
import { SoktCaller } from './pollen/soktCaller.ts';
import type { Codec } from '@gershy/util-codec-parse';
import type { AwsRegionTerm, ServiceMap } from '@gershy/lilac';

type AnyLambdaHttp = LambdaHttp<any, any, any, any, any>;
type LambdaHttpReq<Lbd extends AnyLambdaHttp> = Lbd extends LambdaHttp<any, any, any, infer Cdc, any> ? Codec.Out<Cdc> : never;
type LambdaHttpRes<Lbd extends AnyLambdaHttp> = Lbd extends LambdaHttp<infer Res, any, any, any, any> ? Res : never;

const map:   typeof cl.map   = cl.map;
const upper: typeof cl.upper = cl.upper;

export class HttpGateway<Dmn extends Domain | null = null, Cdn extends boolean = false> extends Flower {
  
  // Note this logical http gateway also handles websockets
  
  static getAwsServices() { return [ 'apigatewayv2', 'acm', 'logs' ] as const; }
  
  protected context: LilacContext;
  protected soil: Soil.Base;
  protected region: AwsRegionTerm;
  protected name: string;
  protected domain: Domain | null;
  protected throttling: { requestsPerIpPerMin: number };
  protected httpScripts: Array<{ method: string, path: `/${string}`, lambda: AnyLambdaHttp, args: { acceptHeaders: string[] } }>;
  protected soktScripts: Array<{ key: string, lambda: AnyLambdaHttp }>;
  protected soktCallers: Array<{ lambda: AnyLambdaHttp }>;
  protected enableCdn: boolean;
  constructor(args: {
    context?: LilacContext,
    soil?: Soil.Base,
    region?: AwsRegionTerm,
    name: string,
    domain?: Dmn,
    enableCdn?: Cdn,
    throttling?: { requestsPerIpPerMin?: number }
  }) {
    
    super();
    
    if (!args.context) throw Error('context missing');
    this.context = args.context;
    
    if (!args.soil) throw Error('soil missing');
    this.soil = args.soil;
    
    this.region = args.region ?? args.soil.getRegion();
    
    this.name = args.name;
    this.domain = args.domain ?? null;
    this.throttling = { requestsPerIpPerMin: 60, ...args.throttling }; // 1 request per sec by default
    this.enableCdn = args.enableCdn ?? false;
    
    this.httpScripts = [];
    this.soktScripts = [];
    this.soktCallers = [];
    
  }
  
  public * getDependencies() {
    
    yield* super.getDependencies();
    if (this.domain) yield* this.domain.getDependencies();
    for (const { lambda } of this.httpScripts) yield* lambda.getDependencies();
    for (const { lambda } of this.soktScripts) yield* lambda.getDependencies();
    for (const { lambda } of this.soktCallers)   yield* lambda.getDependencies();
    
  }
  
  protected getHttpResolver() {
    
    if (this.domain) return `domain/${this.domain.getAddr()}`;
    
    if (this.enableCdn) return `cfDistro/${this.context.pfx}-${this.name}`;
    else                return `apiGw/${this.region}${this.context.pfx}-${this.name}`;
    
  }
  
  // TODO: Lambdas aren't the only possible http handlers! Should add integrations for other
  // handlers, or maybe think of a clever common interface to avoid HttpGateway managing the typing
  // for every possible integration - it's also annoying here, since there are optional "opts" for
  // any integration, which multiplies the type signatures needed
  addHttpScript<Lbd extends AnyLambdaHttp>(
    route: `/${string} -> ${'get' | 'put' | 'post' | 'patch' | 'delete' | 'head'}`,
    args: { acceptHeaders?: string[] },
    lambda: Lbd
  ) { //: HttpHandler<HttpReq, LambdaHttpRes<Lbd>> {
    
    // `this.domain === null` - need to resolve execute api url from what we *do* know
    //  - apigw name -> aws client lookup -> gateway execute-api url
    //  - cfdistro name -> aws client lookup -> cloudfront regional domain
    
    if (lambda.getRegion() !== this.region) throw Error('apiGw lambda region mismatch')[cl.mod]({
      apiGwRegion: this.region,
      lambdaRegion: lambda.getRegion()
    });
    
    const [ path, method ] = route[cl.cut](' -> ', 1)[cl.map](v => v.trim()) as [ `/${string}`, HttpReq['method'] ];
    this.httpScripts.push({ path, method, lambda, args: { acceptHeaders: args.acceptHeaders ?? [] } });
    
    // TODO: HEEERE1 - no matter how the gw is configured, what ever returns from this method can
    // have `.resolveApi(soil)` called on it, and it will result in a HttpHandler!
    // Also, HttpHandler's typing is completely wrong - the current attempt narrows everything donw
    // to a single query+body, but really sub-queries, i.e. sub-paths, different methods, etc.
    // should be supported too! And need to think about how `HttpHandler` and `http` serve varying
    // roles.......
    // Note `aws_acm_certificate_validation` for test.org was causing `terraform apply` to hang...
    // need to test, and clean up any lingering debug output! E.g. `lilac` is setting `onData` to
    // see line-by-line terraform output; that should be cleaned up. Overall goal is to test an
    // HttpGateway with `{ domain: null, enableCdn: false }` with the test calling an endpoint
    // automatically, and validating the lambda response!
    // ALSO need to think about the domain name deal... how to run domain validation when the
    // nameservers are not already hooked up??
    // ALSOOOOOOO need to push this to git+npm....
    // gotta run `{ act: 'setCommit', unit: 'clearing' }`....
    
    // [ ] addHttpHandler functions with and without domain name, and with and without cdn
    // [ ] `HttpHandler` vs `http`? Simplify??
    // [ ] Write test with `HttpGateway({ ..., domain: null, enableCdn: false })` http query,
    //     response validation
    // [ ] Domain validation before nameservers are set - Output should mention 72hr window??
    // [ ] Manager method of running tests using node_module dependencies, *not* paths...
    // [ ] Push everything to git+npm
    
    return new HttpCaller<LambdaHttpReq<Lbd>, LambdaHttpRes<Lbd>>({
      
      context: this.context,
      serviceId: this.getHttpResolver()
      
    });
    
  }
  
  addSoktScript<Lbd extends AnyLambdaHttp>(key: '$connect' | '$disconnect' | '$default' | string, lambda: Lbd) {
    
    // Note that sokt handlers react to inbound socket events: launch, closed, notice (event)
    // For outbound sokt events (closed, notice) use `addSoktProducer`
    // (TODO: Rename this to `addSoktConsumer`?? Listener?)
    // producer
    // listener
    
    if (lambda.getRegion() !== this.region) throw Error('apiGw lambda region mismatch')[cl.mod]({
      apiGwRegion: this.region,
      lambdaRegion: lambda.getRegion()
    });
    
    this.soktScripts.push({ key, lambda });
    
    if (this.domain) {
      
      const netProc = this.domain?.getNetProc();
      return new SoktScript({
        netProc: { ...netProc, proto: netProc.proto === 'http' ? 'ws' : 'wss' },
        key
      });
      
    }
    
  }
  
  addSoktCaller(lambda: AnyLambdaHttp) {
    
    if (lambda.getRegion() !== this.region) throw Error('apiGw lambda region mismatch')[cl.mod]({
      apiGwRegion: this.region,
      lambdaRegion: lambda.getRegion()
    });
    
    this.soktCallers[cl.add]({ lambda });
    return new SoktCaller({});
    
  }
  
  public getServiceMapTf(): ServiceMap {
    
    if (this.domain) return {
      // No lookup necessary if domain is already known
      // [`domain/${this.domain.getAddr()}`]: this.domain.getAddr()
    };
    
    if (this.enableCdn) return {
      [`cfDistro/${this.context.pfx}-${this.name}`]: {
        addr: this.computeCloudfrontPetal({}).ref('domainName'),
        port: 443
      }
    };
    
    const apiPetal = this.computeHttpApiPetal({});
    const stagePetal = this.computeHttpStagePetal({});
    return {
      [`apiGw/${this.context.pfx}-${this.name}/${this.region}`]: {
        addr: apiPetal.ref('apiEndpoint'), // Note api_endpoint is `https://${apiId}.execute-api.${region}.amazonaws.com` - invoke_url is the same, but appends the path: `/${stageName}`
        port: 443,
        http: { path: [ stagePetal.ref('name') ] }
      }
    };
    
  }
  
  public computeCloudfrontPetal(args: Obj<any>) {
    return new PetalTerraform.Resource('awsCloudfrontDistribution', `${this.name}Hgw`, args);
  }
  public computeHttpApiPetal(args: Obj<any>) {
    return new PetalTerraform.Resource('awsApigatewayv2Api', `${this.name}HgwHttp`, args);
  }
  public computeHttpStagePetal(args: Obj<any>) {
    return new PetalTerraform.Resource('awsApigatewayv2Stage', `${this.name}HgwHttp`, args);
  }
  public computeSoktApiPetal(args: Obj<any>) {
    return new PetalTerraform.Resource('awsApigatewayv2Api', `${this.name}HgwSokt`, args);
  }
  public computeSoktStagePetal(args: Obj<any>) {
    return new PetalTerraform.Resource('awsApigatewayv2Stage', `${this.name}HgwSokt`, args);
  }
  
  async computePetals() {
    
    // Consider: the terraform naming convention is all over the place.
    // Note that terraform block names ("handles") include "hgw" ("http gateway") - this is so that
    // two Flowers of different types but with the same name still produce unique terraform blocks!
    // 
    // Actual terraform state attributes involving the name (i.e. the user-provided,
    // unique-within-the-resource-type identifier; for e.g. hgw it's simply the "name" field)- need
    // to be prefixed with the LilacContext's `pfx` - this prevents collisions between Gardens!
    
    const ctx = this.context;
    const soil = this.soil;
    const regionProvider = tf.provider(soil.getRegion(), this.region);
    const globalProvider = tf.provider(soil.getRegion(), 'us-east-1');
    
    // TODO: Prevent direct access to api gateway via public invoke url:
    // Add resource policies to API Gateway to only allow requests from CloudFront.
    const petals = new Set<PetalTerraform.Base>();
    const addPetal = <P extends PetalTerraform.Base>(p: P): P => (petals.add(p), p);
    
    // Note the processes of defining http and sokt resources are very similar! Lotsa repetition...
    
    const { Resource } = PetalTerraform;
    const httpApi = addPetal(this.computeHttpApiPetal({
      
      ...regionProvider,
      
      name:         `${ctx.pfx}-${this.name}`,
      protocolType: 'http'[cl.upper]()
      
    }));
    const httpStage = addPetal(this.computeHttpStagePetal({
      
      ...regionProvider,
      
      apiId:      httpApi.ref('id'),
      name:       `${ctx.pfx}-${this.name}-http`,
      autoDeploy: true,
      
      // Note the stage can define *global* throttling - not sure if we ever want this??
      // defaultRouteSettings: {
      //   throttlingBurstLimit: 100, // Max parallel requests per burst (need more info - how are "bursts" detected/gated??)
      //   throttlingRateLimit:  50,  // Requests per sec
      // },
      stageVariables: {
        
        // Note the full `stageVariables` payload must be <= 2kb
        // TODO: Lambdas should obtain the http/sokt urls from these stage variables - not env!!
        // TODO: Should add opinions about what *must* exist in `stageVariables`, and
        // enforce/expose it through typing both here and in `HttpLambda`!!
        
        //debug: ctx.debug.toString() // Note - different stages should be able to have different values here!!!
        
      }
      
    }));
    
    const soktApi = addPetal(this.computeSoktApiPetal({
      
      ...regionProvider,
      
      name:         `${ctx.pfx}-${this.name}-sokt`,
      protocolType: 'websocket'[cl.upper](),
      
    }));
    const soktStage = addPetal(this.computeSoktStagePetal({
      
      ...regionProvider,
      
      apiId:       soktApi.ref('id'),
      name:        `${ctx.pfx}-${this.name}-sokt`,
      autoDeploy:  true,
      
    }));
    
    const lambdaTfEntities = await Promise.all([
      ...this.httpScripts[cl.map](async ({ path, method, lambda }) => {
        
        // The lambda resolves to several TfEntities
        const lbdEnts = await lambda.getPetals();
        
        // Find the specific lambda function TfEntity
        const lbd = lbdEnts.find(ent => ent.getType() === 'awsLambdaFunction')!;
        
        const integration = addPetal(new Resource('awsApigatewayv2Integration', phrasing('parts->camel', [ this.name, 'hgw', lbd.getHandle() ]), {
          ...regionProvider,
          apiId: httpApi.ref('id'),
          integrationType: phrasing('camel->snake', 'awsProxy')[upper](),
          integrationUri: lbd.ref('invokeArn')
        }));
        const route = addPetal(new Resource('awsApigatewayv2Route', phrasing('parts->camel', [ this.name, 'hgw', lbd.getHandle() ]), {
          ...regionProvider,
          apiId:    httpApi.ref('id'),
          routeKey: `${method[upper]()} ${path}`,
          target:   `integrations/${tf.embed(integration.refStr('id'))}`
        }));
        const permission = addPetal(new Resource('awsLambdaPermission', phrasing('parts->camel', [ this.name, 'hgw', lbd.getHandle() ]), {
          ...regionProvider,
          statementId:  `${ctx.pfx}-${this.name}-${phrasing('camel->kebab', lbd.getHandle())}`,
          action:       'lambda:InvokeFunction',
          functionName: lbd.ref('functionName'),
          principal:    'apigateway.amazonaws.com',
          sourceArn:    `${tf.embed(httpApi.refStr('executionArn'))}/*/*`
        }));
        void [ integration, route, permission ];
        
      }),
      ...this.soktScripts[map](async ({ key, lambda }) => {
        
        const lbdEnts = await lambda.getPetals();
        const lbd = lbdEnts.find(ent => ent.getType() === 'awsLambdaFunction')!;
        
        const integration = addPetal(new Resource('awsApigatewayv2Integration', phrasing('parts->camel', [ this.name, 'hgw', 'sokt', lbd.getHandle() ]), {
          ...regionProvider,
          apiId: soktApi.ref('id'),
          integrationType: phrasing('camel->snake', 'awsProxy')[upper](),
          integrationUri: lbd.ref('invokeArn')
        }));
        const route = addPetal(new Resource('awsApigatewayv2Route', phrasing('parts->camel', [ this.name, 'hgw', 'sokt', lbd.getHandle() ]), {
          ...regionProvider,
          apiId:    soktApi.ref('id'),
          routeKey: key,
          target:   `integrations/${tf.embed(integration.refStr('id'))}`
        }));
        const permission = addPetal(new Resource('awsLambdaPermission', phrasing('parts->camel', [ this.name, 'hgw', 'sokt', lbd.getHandle() ]), {
          ...regionProvider,
          statementId:  `${ctx.pfx}-${this.name}-${phrasing('camel->kebab', lbd.getHandle())}`,
          action:       'lambda:InvokeFunction',
          functionName: lbd.ref('functionName'),
          principal:    'apigateway.amazonaws.com',
          sourceArn:    `${tf.embed(soktApi.refStr('executionArn'))}/*/*`
        }));
        void [ integration, route, permission ];
        
      }),
      ...this.soktCallers[map](async ({ lambda }) => {
        
        const lbdEnts = await lambda.getPetals();
        const tfIamRole = lbdEnts.find(p => p.getType() === 'awsIamRole')!;
        const lambdaPolicyName = phrasing('parts->camel', [ 'lambdaApiGwManage', lambda.getName(), this.name, 'hgw' ]);
        const lambdaPolicy = addPetal(new Resource('awsIamPolicy', lambdaPolicyName, {
          ...regionProvider,
          name: `${ctx.pfx}-${lambdaPolicyName}`,
          policy: tf.json(aws.capitalKeys({ version: '2012-10-17', statement: [{
            effect: phrasing('camel->kamel', 'allow'),
            action: [ 'execute-api:ManageConnections' ],
            resource: [
              // The iam permissions for management need to be on this arn:
              // `${tf.embed(soktApi.refStr('arn'))}/${tf.embed(soktStage.refStr('name'))}/POST/@connections/*`,
              `${tf.embed(soktApi.refStr('execution_arn'))}/${tf.embed(soktStage.refStr('id'))}/POST/@connections/*`,
            ]
          }]}))
        }));
        
        const lambdaPolicyAttachment = addPetal(new Resource('awsIamRolePolicyAttachment', lambdaPolicyName, {
          ...regionProvider,
          role:      tfIamRole.ref('name'),
          policyArn: lambdaPolicy.ref('arn')
        }));
        void lambdaPolicyAttachment;
        
      })
    ]);
    void lambdaTfEntities;
    
    // Custom domain setup (certificates, DNS, domain mappings)
    // Skip if no custom domain provided - will use default execute-api or cloudfront URLs
    const domainInfra = await (async () => {
      
      if (!this.domain) return null;
      
      const hostedZone = await this.domain.getPetals().then(petals => petals.find(p => p.getType() === 'awsRoute53Zone')!);
      
      // Certificate setup - CloudFront requires us-east-1; API Gateway custom domains use regional certs
      const domainHandle = `domain${this.enableCdn ? 'Use1' : 'Regional'}${this.domain.getAddrPcs()[map](p => phrasing('camel->kamel', p)).join('').replace(/[^a-zA-Z0-9]/g, '')}`;
      
      const domainCert = addPetal(new Resource('awsAcmCertificate', domainHandle, {
        
        // With cloudfront, domain needs to exist in global provider - otherwise regional! (As
        // without cloudfront, it's assigned to the *regional* http gateway!)
        ...(this.enableCdn ? globalProvider : regionProvider),
        
        domainName: this.domain.hasSubdomain()
          ? `${'*.'}${this.domain.getAddrBase()}`
          : `${''  }${this.domain.getAddrBase()}`,
        validationMethod: 'dns'[upper]()
        
      }));
      const domainDns = addPetal(new Resource('awsRoute53Record', domainHandle, {
        
        ...(this.enableCdn ? globalProvider : regionProvider),
        
        // Need to create some dns records to facilitate the validation!
        forEach: `| { for opt in ${domainCert.refStr('domainValidationOptions')} : opt.${phrasing('camel->snake', 'domainName')} => opt }`,
        zoneId:  hostedZone.ref('zoneId'),
        name:    `| each.value.${phrasing('camel->snake', 'resourceRecordName')}`,
        type:    `| each.value.${phrasing('camel->snake', 'resourceRecordType')}`,
        records: `| [ each.value.${phrasing('camel->snake', 'resourceRecordValue')} ]`,
        ttl:     60 * 5
        
      }));
      const domainValidation = addPetal(new Resource('awsAcmCertificateValidation', domainHandle, {
        
        ...(this.enableCdn ? globalProvider : regionProvider),
        
        certificateArn:        domainCert.ref('arn'),
        validationRecordFqdns: `| [ for rec in ${domainDns.refStr()} : rec.fqdn ]`
        
      }));
      
      return { domain: this.domain, hostedZone, domainHandle, domainCert, domainDns, domainValidation };
      
    })();
    
    if (this.enableCdn) { // An api with a cdn, and optional domain
      
      // CDN setup: cf + waf, using l@e to map websocket actions
      
      const firewall = addPetal(new Resource('awsWafv2WebAcl', `${this.name}Hgw`, {
        
        ...globalProvider,
        
        name: `${ctx.pfx}-${this.name}Firewall`,
        scope: 'cloudfront'[upper](),
        description: 'firewall',
        
        $defaultAction: {
          $allow: {}
        },
        $rule: {
          
          name: 'rateLimit',
          priority: 1,
          
          $action: { $block: {} },
          
          $statement: {
            $rateBasedStatement: {
              limit: this.throttling.requestsPerIpPerMin * 5, // Value is requests per 5min
              aggregateKeyType: 'ip'[upper]()
            }
          },
          
          $visibilityConfig: {
            metricName: 'rateLimitBlock',
            sampledRequestsEnabled: false,
            cloudwatchMetricsEnabled: false,
          },
          
        },
        
        $visibilityConfig: {
          metricName: 'rateLimit',
          sampledRequestsEnabled: false,
          cloudwatchMetricsEnabled: false,
        }
        
      }));
      
      // TODO: watch out creating Flowers within Flowers... it's not using the registry!! I think
      // `registry` needs to be handed down to instances, same as `context` and `soil`... ugh
      const lbdEdge = new LambdaEdge({
        
        soil:      this.soil,
        context:   this.context,
        
        region:    'us-east-1',
        name:      `${this.name}SoktEdgeFn`,
        localData: {},
        codec:     { type: 'rec', loose: true, props: { uri: { type: 'str' } } } as const,
        baseUrl:   import.meta.url,
        launchFn:  ctx => null,
        env:       {},
        
        invokeFn: args => ({
          // Simply transform the uri by stripping the websocket prefix
          ...args.shapeData,
          uri: args.args.uri.replace('/api/websocket', '') || '/'
        })
        
      });
      
      // Kinda ugly; we create the instance then grab all its petals...
      const lambdaPetals = await lbdEdge.getPetals();
      for (const lp of lambdaPetals) addPetal(lp);
      
      const lambdaFnPetal = lambdaPetals.find(p => p.getType() === 'awsLambdaFunction')!;
      
      const baseCacheConfigHttp = addPetal(new Resource('awsCloudfrontCachePolicy', `${this.name}Hgw`, {
        
        ...globalProvider,
        
        name: `${ctx.pfx}-${this.name}CacheConfig`,
        defaultTtl: 0, // Consider setting up caching!! (Requires increasing these values, and sending caching headers from lambdas)
        minTtl: 0,
        maxTtl: 3600,
        
        // Note these have no effect on what is forwarded to the origin if the
        // awsCloudfrontCachePolicy has a sibling awsCloudfrontOriginRequestPolicy item - if the
        // sibling is present, the orp fully determines what is sent to the origin! In our case,
        // `baseCacheConfigHttp` will be accompanied by `baseOriginRequestPolicyHttp`
        $parametersInCacheKeyAndForwardedToOrigin: {
          
          // Only the query string fragments the cache - headers are obviously undesirable due to
          // e.g. "user agent", and cookies are private to individual users - we probably don't want
          // them effecting a shared cache like cloudfront; maybe there's some potential to allow
          // users to cache their cookie-related private values in cf instead of in their browser...
          // to alleviate browser memory constraints? I dunno...
          $headersConfig:      { headerBehavior:      'none' },
          $cookiesConfig:      { cookieBehavior:      'none' },
          $queryStringsConfig: { queryStringBehavior: 'all' },
          
          enableAcceptEncodingGzip:   true,
          enableAcceptEncodingBrotli: true
          
        }
        
      }));
      const baseOriginRequestPolicyHttp = addPetal(new Resource('awsCloudfrontOriginRequestPolicy', `${this.name}HgwOrpBase`, {
        
        ...globalProvider,
        
        name:                `${ctx.pfx}-${this.name}OrpBase`,
        $headersConfig:      { headerBehavior:      'none' },
        $cookiesConfig:      { cookieBehavior:      'all' },
        $queryStringsConfig: { queryStringBehavior: 'all' }
        
      }));
      const cloudfront = addPetal(this.computeCloudfrontPetal({
        
        ...globalProvider,
        
        // Redirect settings
        ...(domainInfra && { aliases: [ domainInfra.domain.getAddr() ] }),
        
        $origin$0: {
          
          // The "origin" is the entity behind the cloudfront proxy - this one is the http api
          originId: 'httpApi',
          
          // Note cloudfront wants a url without any protocol or path!!
          domainName: `| regex("${/^https?:[/][/]([^/]+)([/].*)$/.toString().slice(1, -1)}", ${httpStage.refStr('invokeUrl')})[0]`,
          originPath: `| regex("${/^https?:[/][/]([^/]+)([/].*)$/.toString().slice(1, -1)}", ${httpStage.refStr('invokeUrl')})[1]`,
          
          $customOriginConfig: {
            httpPort: 80,
            httpsPort: 443,
            originProtocolPolicy: 'https-only', // Only communicate with apigw over https (which is all apigw supports)
            originSslProtocols: [ `${'tls'[upper]()}v1.2` ]
          }
          
        },
        $origin$1: {
          
          // Here's the sokt api for cloudfront...
          originId: 'soktApi',
          
          domainName: `| regex("${/^wss?:[/][/]([^/]+)([/].*)$/.toString().slice(1, -1)}", ${soktStage.refStr('invokeUrl')})[0]`,
          originPath: `| regex("${/^wss?:[/][/]([^/]+)([/].*)$/.toString().slice(1, -1)}", ${soktStage.refStr('invokeUrl')})[1]`,
          
          $customOriginConfig: {
            httpPort: 80,
            httpsPort: 443,
            originProtocolPolicy: 'https-only', // Only communicate with apigw over https (which is all apigw supports)
            originSslProtocols: [ `${'tls'[upper]()}v1.2` ]
          }
          
        },
        
        // More settings...
        comment: `${ctx.pfx}-${this.name}`,
        priceClass: 'PriceClass_100', // cheapest - only pushes to cheap edge locations (e.g. us, ca)
        enabled: true,
        isIpv6Enabled: true,
        defaultRootObject: '',
        
        // A single origin request policy for sokt...
        // Redirect "/api/websocket" requests to sokt origin
        $orderedCacheBehavior$0: {
          
          pathPattern: '/api/websocket',
          targetOriginId: 'soktApi',
          allowedMethods: 'head,get'[upper]().split(','),
          cachedMethods: 'head,get'[upper]().split(','),
          
          cachePolicyId: addPetal(new Resource('awsCloudfrontCachePolicy', `${this.name}HgwSokt`, {
            
            ...tf.provider(this.soil.getRegion(), 'us-east-1'),
            name: `${ctx.pfx}-${this.name}CacheConfigSokt`,
            
            // The max ttl of 0 disables caching entirely for ws
            defaultTtl: 0, minTtl: 0, maxTtl: 0,
            
            // Note these have no effect on what is forwarded to the origin due to presence of an
            // accompanying orp
            $parametersInCacheKeyAndForwardedToOrigin: {
              // Note that due to `maxTtl: 0`, *all* of these must be "none"
              $headersConfig:      { headerBehavior:      'none' },
              $cookiesConfig:      { cookieBehavior:      'none' },
              $queryStringsConfig: { queryStringBehavior: 'none' }
            }
            
          })).ref('id'),
          
          originRequestPolicyId: addPetal(new Resource('awsCloudfrontOriginRequestPolicy', `${this.name}HgwOrpSokt`, {
            name: `${ctx.pfx}-${this.name}OrpSokt`,
            $headersConfig: {
              headerBehavior: 'whitelist',
              $headers: { items: [
                'Sec-WebSocket-Key',
                'Sec-WebSocket-Version',
                'Sec-WebSocket-Protocol',
                'Sec-WebSocket-Extensions',
              ]}
            },
            // Consider forwarding cookies and query strings??
            $cookiesConfig:      { cookieBehavior:      'all' },
            $queryStringsConfig: { queryStringBehavior: 'all' }
          })).ref('id'),
          
          viewerProtocolPolicy:  'redirect-to-https',
          
          $lambdaFunctionAssociation: {
            eventType: 'origin-request',
            lambdaArn: lambdaFnPetal.ref('qualifiedArn'),
            includeBody: false
          }
          
        },
        
        // Any number of origin request policies for http
        ...(() => {
          
          const routeOrps = this.httpScripts.filter(r => r.args?.acceptHeaders.length)[map]((route, n) => {
            const headers = route.args!.acceptHeaders;
            return {
              path: route.path,
              method: route.method,
              originRequestPolicy: addPetal(new Resource('awsCloudfrontOriginRequestPolicy', `${this.name}HgwOrp${n}`, /* "origin request policy" */ {
                name: `${ctx.pfx}-${this.name}Orp${n}`,
                $headersConfig: {
                  headerBehavior: 'whitelist',
                  
                  // Cloudfront makes it illegal to specify certain headers (not sure about casing)
                  $headers: { items: headers.filter(h => h !== 'Connection' && h !== 'Upgrade') },
                  
                  // This is a nice idea, but cloudfront has a limit of 10 headers, which is exceeded too
                  // easily when the number of headers is tripled - UGH
                  // The real solution here seems convoluted: use Lambda@Edge to normalize all headers
                  // before they're processed by cloudfront
                  // Note this was also contrived, motivated by paypal's full-upper header style...
                  // $headers: { items: [
                  //  
                  //   // Cloudfront treats headers *case-sensitively* - for given input headers, include
                  //   // 3x the headers - for fully lowercase, fully uppercase, and capitalized styles
                  //   ...headers[map](v => kebabCase(v)),
                  //   ...headers[map](v => kebabCase(v))[map](v => v[upper]()),
                  //   ...headers[map](v => kebabCase(v))[map](v => v.split('-')[map](v => capitalize(v)).join('-'))
                  //   
                  // ]}
                },
                $cookiesConfig:      { cookieBehavior:      'all' },
                $queryStringsConfig: { queryStringBehavior: 'all' }
              }))
            };
          });
          
          return routeOrps[cl.toObj](({ path, method, originRequestPolicy }, n) => {
            
            return [ `$orderedCacheBehavior$${n + 1}`, {
              pathPattern:           path,
              allowedMethods:        {
                
                // Cloudfront supports fixed lists of allowed methods (cannot supply arbitrary lists of
                // methods) - but we know the exact method; given that method, use the minimal set of
                // methods supported by cloudfront
                
                // Note that 'head,get' is a more minimal option than anything here, but it's illegal
                // to specify a (cached method) that isn't in (allowed methods), and we want to specify
                // options in our cached methods.
                
                head:      'head,get,options',
                get:       'head,get,options',
                options:   'head,get,options'
                
              }[cl.at](method, 'head,delete,post,get,options,put,patch')[upper]().split(','),
              
              // Here we specify caching for some methods, but whether this actually takes effect
              // depends on http headers returned by the specific endpoint! 
              cachedMethods:         'head,get,options'[upper]().split(','),
              targetOriginId:        'httpApi',
              cachePolicyId:         baseCacheConfigHttp.ref('id'), // Base caching simply means "headers: no, cookies: no, query string: yes"
              originRequestPolicyId: originRequestPolicy.ref('id'), // This cache-behaviour-specific orp mostly whitelists headers
              viewerProtocolPolicy:  'redirect-to-https'
            }];
            
          });
          
        })(),
        
        $defaultCacheBehavior: {
          
          targetOriginId: 'httpApi', // Reference an embedded origin by id
          viewerProtocolPolicy: 'redirect-to-https',
          
          allowedMethods: 'head,options,get,post,put,patch,delete'[upper]().split(','),
          cachedMethods:  'head,get,options'[upper]().split(','),
          
          // The base cache config and orp result in caching only based on path+queryString, and
          // forwarding cookies and queryString (not headers) to the origin
          cachePolicyId:         baseCacheConfigHttp.ref('id'),
          originRequestPolicyId: baseOriginRequestPolicyHttp.ref('id')
          
        },
        
        $restrictions: {
          $geoRestriction: {
            restrictionType: 'none'
          }
        },
        
        webAclId: firewall.ref('arn'), // Yes... "arn", not "id"
        
        // Set up a viewer certificate
        ...(domainInfra
          ? {
              $viewerCertificate: {
                acmCertificateArn: domainInfra.domainCert.ref('arn'),
                sslSupportMethod: phrasing('camel->kebab', 'sniOnly'), // "server name indication"; the client always mentions the hostname they're connecting to; this says to use that mentioned hostname to determine the cert (multiple hostnames may exist under the same cloudfront/ip address)
                minimumProtocolVersion: 'TLSv1.2_2019'
              },
              dependsOn: [ domainInfra.domainValidation.ref() ]
            }
          : { $viewerCertificate: { cloudfrontDefaultCertificate: true } }
        ),
        
      }));
      
      // Add a log group for cloudfront... FOR EVERY REGION... OOWOWWWWWW
      for (const region of awsRegions)
        addPetal(new Resource('awsCloudwatchLogGroup', `${this.name}HgwLogs${phrasing('camel->kamel', region.mini)}`, {
          ...tf.provider(this.soil.getRegion(), region.term),
          name: `/aws/cloudfront/LambdaEdge/${tf.embed(cloudfront.refStr('id'))}`,
          retentionInDays: 14
        }));
    
      if (domainInfra) {
        
        // Connect our domain name as an entrypoint to cloudfront
        const cloudfrontDns = addPetal(new Resource('awsRoute53Record', `${this.name}Hgw`, {
          
          // Define the given domain name as an alias for cloudfront's address!
          // Note this form of "a" record is unique to aws - it points a domain to another domain,
          // whereas typical "a" records point an ip address to a domain.
          
          ...globalProvider,
          
          zoneId: domainInfra.hostedZone.ref('id'),
          name: domainInfra.domain.getAddr(),
          type: 'a'[upper](),
          
          $alias: {
            name:                 cloudfront.ref('domainName'),
            zoneId:               cloudfront.ref('hostedZoneId'),
            evaluateTargetHealth: false
          }
          
        }));
        void cloudfrontDns;
        
      } else {
        
        // Without a domain, add an output exposing the cloudfront distribution itself
        addPetal(new PetalTerraform.Output(phrasing('parts->camel', [ this.name, 'hgw', 'output' ]), cloudfront.ref('domainName'), async addr => {
          return { serviceMap: {
            [`cfDistro/${this.context.pfx}-${this.name}`]: { addr, port: 443 }
          }};
        }));
        
      }
      
    } else if (domainInfra) { // An api without a cdn but with a domain
      
      // Direct dns -> gateway access
      
      const apiDomainName = addPetal(new Resource('awsApigatewayv2DomainName', `${this.name}Hgw`, {
        
        ...regionProvider,
        
        domainName: domainInfra.domain.getAddr(),
        $domainNameConfiguration: {
          certificateArn: domainInfra.domainCert.ref('arn'),
          endpointType: 'regional'[upper](),
          securityPolicy: 'TLS_1_2'
        },
        dependsOn: [ domainInfra.domainValidation.ref() ]
        
      }));
      
      // Map both HTTP and WebSocket APIs to the custom domain
      // Note: API Gateway v2 allows multiple API mappings on a single domain using different path keys
      // HTTP API gets the root path, WebSocket API gets /api/websocket
      const httpApiMapping = addPetal(new Resource('awsApigatewayv2ApiMapping', `${this.name}HgwHttp`, {
        
        ...regionProvider,
        
        apiId: httpApi.ref('id'),
        domainName: apiDomainName.ref('id'),
        stage: httpStage.ref('id')
        // No apiMappingKey means this handles the root path
        
      }));
      void httpApiMapping;
      
      const soktApiMapping = addPetal(new Resource('awsApigatewayv2ApiMapping', `${this.name}HgwSokt`, {
        
        ...regionProvider,
        
        apiId: soktApi.ref('id'),
        domainName: apiDomainName.ref('id'),
        stage: soktStage.ref('id'),
        // Requests to wss://domain/api/websocket/* route to the websocket API
        // The path prefix is stripped before reaching the websocket routes
        apiMappingKey: 'api/websocket'
        
      }));
      void soktApiMapping;
      
      // Point domain to API Gateway
      const apiDns = addPetal(new Resource('awsRoute53Record', `${this.name}Hgw`, {
        
        ...globalProvider,
        
        zoneId: domainInfra.hostedZone.ref('id'),
        name: domainInfra.domain.getAddr(),
        type: 'a'[upper](),
        
        $alias: {
          name:                 apiDomainName.ref('domainNameConfiguration.0.targetDomainName'),
          zoneId:               apiDomainName.ref('domainNameConfiguration.0.hostedZoneId'),
          evaluateTargetHealth: false
        }
        
      }));
      void apiDns;
      
    } else { // An api without a cdn or domain
      
      // Without cdn or domain, add an output exposing the apiGw itself
      const tfOutput = {
        addr: httpApi.ref('apiEndpoint'),
        stageName: httpStage.ref('name')
      };
      addPetal(new PetalTerraform.Output(`${this.name}Output`, tfOutput, async (args: any) => {
        
        console.log('ZZZ', args);
        
        return { serviceMap: {
          [`apiGw/${this.region}/${this.context.pfx}-${this.name}`]: {
            addr: args.addr.replace(/^https?:[/][/]/, ''),
            port: 443,
            http: { path: [ args.stageName ] }
          }
        }};
        
      }));
      
    }
    
    return [ ...petals ];
    
  }
};
