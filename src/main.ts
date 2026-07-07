import '@gershy/clearing';

import { Flower, PetalTerraform, Soil, type Context as LilacContext } from '@gershy/lilac';
import { Domain } from '@gershy/lilac-domain';
import Logger from '@gershy/logger';
import type { JsfnInstSer } from '@gershy/util-jsfn-encode';
import type { HttpArgs, HttpReq, HttpRes, NetProc } from '@gershy/util-http';
import type { LambdaHttp } from '@gershy/lilac-lambda-http';
import * as aws from './util/aws.ts';
import * as tf from './util/terraform.ts';
import { ApiGatewayManagementApiClient as ApiGwClient, PostToConnectionCommand as SocketSend } from '@aws-sdk/client-apigatewaymanagementapi';
import awsRegions from './util/awsRegions.ts';
import { getLambdaEdgeCodec, LambdaEdge } from './lambdaEdge/main.ts';
import phrasing from '@gershy/util-phrasing';

type AnyLambdaHttp = LambdaHttp<any, any, any, any, any>;
type LambdaHttpRes<Lbd extends AnyLambdaHttp> = Lbd extends LambdaHttp<infer Res, any, any, any, any> ? Res : never;

const map:      typeof cl.map      = cl.map;
const upper:    typeof cl.upper    = cl.upper;

export class HttpHandler<Req extends HttpReq, Res extends HttpRes> {
  
  // Represents an http handler, which is addressable via a url and returns
  
  private netProc: NetProc;
  private path: string[];
  private method: HttpReq['method'];
  constructor(args: { netProc: NetProc, path: string[], method: HttpReq['method'] }) {
    this.netProc = args.netProc;
    this.path = args.path;
    this.method = args.method;
  }
  getUrl() {
    
    const { proto, addr, port } = this.netProc;
    const defPort = { http: 80, https: 443 }[proto];
    return [
      proto, '://', addr,
      ...(port === defPort  ? [] : [ `:${port}`                ]),
      ...(!this.path.length ? [] : [ `/${this.path.join('/')}` ])
    ].join('');
    
  }
  getHttpArgs() {
    return {
      // $req: null as any as Req,
      // $res: null as any as Res,
      netProc: this.netProc,
      path: this.path,
      method: this.method
      // query: {} as { [K: string]: never }
    } as any as HttpArgs<Req, Res>;
  }
  toJsfn() {
    const { netProc, path, method } = this;
    return {
      hoist: `${import.meta.dirname}::{${this.constructor.name}}` as const,
      form: this.constructor as typeof HttpHandler<any, any>,
      args: [ { netProc, path, method } ]
    } satisfies JsfnInstSer<typeof HttpHandler<Req, Res>>;
  }
  
};
export class SoktHandler {
  
  protected netProc: NetProc;
  protected key: string;
  constructor(args: { netProc: NetProc, key: string }) {
    this.netProc = args.netProc;
    this.key = args.key;
  }
  getUrl() {
    
    // This path corresponds to the fixed path defined by the HttpGateway lilac
    const { proto, addr, port } = this.netProc;
    const defPort = { http: 80, https: 443 }[proto];
    return [
      proto, '://', addr,
      ...(port === defPort  ? [] : [ `:${port}`                ]),
      '/api/websocket'
    ].join('');
    
  }
  toJsfn() {
    
    const { netProc, key } = this;
    return {
      hoist: `${import.meta.dirname}::{${this.constructor.name}}` as const,
      form: this.constructor as typeof SoktHandler,
      args: [ { netProc, key } ]
    } satisfies JsfnInstSer<typeof SoktHandler>;
    
  }
  
};
export class SoktProducer {
  
  private client: ApiGwClient;
  private endpoint: string;
  
  constructor(args: { client?: ApiGwClient }) {
    
    // Note HttpGateway ensures "sokt_url" and "http_url" env vars are available on every lambda
    
    // Even though our overall desire is to send sokt events, we still want to communicate with the
    // management api over http (the management api receives http, and performs sokt actions!)
    this.endpoint = process.env.sokt_url!.replace(/^wss:[/][/]/, 'https://');
    this.client   = args.client ?? new ApiGwClient({ endpoint: this.endpoint });
    
  }
  
  socketSend(args: { logger: Logger, soktUid: string, payload: Json }) {
    
    const { logger, soktUid, payload } = args;
    return logger.scope('apigw.socketSend', { endpoint: this.endpoint, soktUid, payload }, async logger => {
      
      const result = await this.client.send(new SocketSend({
        ConnectionId: soktUid,
        Data: cl.isCls(payload, String) ? payload : JSON.stringify(payload)
      }));
      logger.log({ $$: 'result', result: { metadata: result.$metadata[cl.map](v => v ?? null) } });
      
    });
    
  }
  
  toJsfn() {
    
    // const {} = this;
    return {
      hoist: `${import.meta.dirname}::{${this.constructor.name}}` as const,
      form: this.constructor as typeof SoktProducer,
      args: [ {} ]
    } satisfies JsfnInstSer<typeof SoktProducer>;
    
  }
  
};

export type HttpGatewayArgs = {
  name: string,
  description: string,
  protocol: 'http' | 'https',
  domain: Domain,
  throttling: { requestsPerIpPerMin: number }
};
export type HttpGatewayHandlerOpts = {
  acceptHeaders: string[]
};
export class HttpGateway extends Flower {
  
  // Note this logical http gateway also handles websockets
  
  protected name: HttpGatewayArgs['name'];
  protected description: HttpGatewayArgs['description'];
  protected proto: 'http' | 'https';
  protected domain: Domain;
  protected throttling: HttpGatewayArgs['throttling'];
  protected httpRoutes: Array<{ method: string, path: `/${string}`, lambda: AnyLambdaHttp, args?: HttpGatewayHandlerOpts }>;
  protected soktRoutes: Array<{ key: string, lambda: AnyLambdaHttp }>;
  protected managers: Array<{ lambda: AnyLambdaHttp }>;
  constructor(args: HttpGatewayArgs) {
    super();
    this.name = args.name;
    this.description = args.description;
    this.proto = args.protocol;
    this.domain = args.domain;
    this.throttling = args.throttling;
    this.httpRoutes = [];
    this.soktRoutes = [];
    this.managers = [];
  }
  
  public * getDependencies() {
    
    yield* super.getDependencies();
    yield* this.domain.getDependencies();
    for (const { lambda } of this.httpRoutes) yield* lambda.getDependencies();
    for (const { lambda } of this.soktRoutes) yield* lambda.getDependencies();
    for (const { lambda } of this.managers)   yield* lambda.getDependencies();
  }
  
  // TODO: Lambdas aren't the only possible http handlers! Should add integrations for other
  // handlers, or maybe think of a clever common interface to avoid HttpGateway managing the typing
  // for every possible integration - it's also annoying here, since there are optional "opts" for
  // any integration, which multiplies the type signatures needed
  addHttpHandler<Lbd extends AnyLambdaHttp>(
    route: `/${string} -> ${'get' | 'put' | 'post' | 'patch' | 'delete' | 'head'}`,
    lambda: Lbd
  ): HttpHandler<HttpReq, LambdaHttpRes<Lbd>>
  addHttpHandler<Lbd extends AnyLambdaHttp>(
    route: `/${string} -> ${'get' | 'put' | 'post' | 'patch' | 'delete' | 'head'}`,
    opts: HttpGatewayHandlerOpts,
    lambda: Lbd
  ): HttpHandler<HttpReq, LambdaHttpRes<Lbd>>
  addHttpHandler(...args: any[]) {
    
    const route = args.find(a => cl.isCls(a, String)) as `/${string} -> ${'get' | 'put' | 'post' | 'patch' | 'delete' | 'head'}`;
    const opts = (args.find(a => cl.isCls(a, Object)) as HttpGatewayHandlerOpts) ?? { acceptHeaders: [] };
    const lambda = args.at(-1) as AnyLambdaHttp;
    
    const [ path, method ] = route[cl.cut](' -> ', 1)[cl.map](v => v.trim()) as [ `/${string}`, HttpReq['method'] ];
    this.httpRoutes.push({ path, method, lambda, args: opts });
    
    return new HttpHandler<any, any>({
      netProc: { proto: this.proto, addr: this.domain.getNameFull(), port: this.domain.getPort() },
      path: path.split('/').slice(1).filter(Boolean),
      method
    });
    
  }
  
  addSoktHandler<Lbd extends AnyLambdaHttp>(
    key: '$connect' | '$disconnect' | '$default' | string,
    lambda: Lbd
  ) {
    
    this.soktRoutes.push({ key, lambda });
    
    return new SoktHandler({
      netProc: { proto: this.proto === 'http' ? 'ws' : 'wss', addr: this.domain.getNameFull(), port: this.domain.getPort() },
      key
    });
    
  }
  
  addSoktProducer(lambda: AnyLambdaHttp) {
    
    this.managers[cl.add]({ lambda });
    return new SoktProducer({});
    
  }
  
  public async cultivate() {
  }
  
  async computePetals(ctx: LilacContext & { soil: Soil.Base }) {
    
    // TODO: Prevent direct access to api gateway via public invoke url:
    // Add resource policies to API Gateway to only allow requests from CloudFront.
    const petals = new Set<PetalTerraform.Base>();
    const addPetal = <P extends PetalTerraform.Base>(p: P): P => (petals.add(p), p);
    
    // Note the processes of defining http and sokt resources are very similar! Lotsa repetition...
    
    const { Resource } = PetalTerraform;
    const httpApi = addPetal(new Resource('awsApigatewayv2Api', this.name, { // Consider: `${this.name}Http`
      name:         `${ctx.pfx}-${this.name}`,
      protocolType: 'http'[cl.upper](),
      description:  `${this.description} - http api`
    }));
    const httpStage = addPetal(new Resource('awsApigatewayv2Stage', this.name, {
      apiId:      httpApi.ref('id'),
      name:       `${ctx.pfx}-${this.name}-http`,
      autoDeploy: true,
      description: `maturity: ${ctx.maturity}; protocol: http`,
      
      // Note the stage can define *global* throttling - not sure if we ever want this??
      // defaultRouteSettings: {
      //   throttlingBurstLimit: 100, // Max parallel requests per burst (need more info - how are "bursts" detected/gated??)
      //   throttlingRateLimit:  50,  // Requests per sec
      // },
      stageVariables: {
        // Note the full `stageVariables` payload must be <= 2kb
        // TODO: Lambdas should obtain the http/sokt urls from these stage variables!!
        // TODO: Should add opinions about what *must* exist in `stageVariables`, and
        // enforce/expose it through typing both here and in `HttpLambda`!!
        //debug: ctx.debug.toString() // Note - different stages should be able to have different values here!!!
      }
      
    }));
    
    const soktApi = addPetal(new Resource('awsApigatewayv2Api', `${this.name}Sokt`, {
      name:         `${ctx.pfx}-${this.name}-sokt`,
      protocolType: 'websocket'[cl.upper](),
      description:  `${this.description} - sokt api`
    }));
    const soktStage = addPetal(new Resource('awsApigatewayv2Stage', `${this.name}Sokt`, {
      apiId:       soktApi.ref('id'),
      name:        `${ctx.pfx}-${this.name}-sokt`,
      autoDeploy:  true,
      description: `maturity: ${ctx.maturity}; protocol: sokt`
    }));
    
    // Every lambda in the http gateway gets environment vars pointing to http/sokt entrypoints
    // TODO: BUGGY! Relies on the gateway being processed first; if not, its lambdas simply won't
    // have the needed env vars set! :(
    for (const lambda of new Set([ ...this.httpRoutes, ...this.soktRoutes, ...this.managers ][cl.map](route => route.lambda)))
      Object.assign((lambda as any).envVars, { // TODO: need a better way to set env vars!
        httpUrl: `${tf.embed(httpStage.refStr('invokeUrl'))}`,
        soktUrl: `${tf.embed(soktStage.refStr('invokeUrl'))}`,
      });
    
    const lambdaTfEntities = await Promise.all([
      ...this.httpRoutes[cl.map](async ({ path, method, lambda }) => {
        
        // The lambda resolves to several TfEntities
        const lbdEnts = await lambda.getPetals(ctx); // TODO: Any zip failure here crashes the whole thing (should let all lambdas acc/rjc, which will include their cleanup)
        
        // Find the specific lambda function TfEntity
        const lbd = lbdEnts.find(ent => ent.getType() === 'awsLambdaFunction')!;
        
        const integration = addPetal(new Resource('awsApigatewayv2Integration', this.name + phrasing('camel->kamel', lbd.getHandle()), {
          apiId: httpApi.ref('id'),
          integrationType: phrasing('camel->snake', 'awsProxy')[upper](),
          integrationUri: lbd.ref('invokeArn')
        }));
        void integration;
        
        const route = addPetal(new Resource('awsApigatewayv2Route', this.name + phrasing('camel->kamel', lbd.getHandle()), {
          apiId:    httpApi.ref('id'),
          routeKey: `${method[upper]()} ${path}`,
          target:   `integrations/${tf.embed(integration.refStr('id'))}`
        }));
        void route;
        
        const permission = addPetal(new Resource('awsLambdaPermission', this.name + phrasing('camel->kamel', lbd.getHandle()), {
          statementId:  `${ctx.pfx}-${this.name}-${phrasing('camel->kebab', lbd.getHandle())}`,
          action:       'lambda:InvokeFunction',
          functionName: lbd.ref('functionName'),
          principal:    'apigateway.amazonaws.com',
          sourceArn:    `${tf.embed(httpApi.refStr('executionArn'))}/*/*`
        }));
        void permission;
        
      }),
      ...this.soktRoutes[map](async ({ key, lambda }) => {
        
        const lbdEnts = await lambda.getPetals(ctx);
        for (const ent of lbdEnts) addPetal(ent);
        const lbd = lbdEnts.find(ent => ent.getType() === 'awsLambdaFunction')!;
        
        const integration = addPetal(new Resource('awsApigatewayv2Integration', this.name + 'Sokt' + phrasing('camel->kamel', lbd.getHandle()), {
          apiId: soktApi.ref('id'),
          integrationType: phrasing('camel->snake', 'awsProxy')[upper](),
          integrationUri: lbd.ref('invokeArn')
        }));
        
        const route = addPetal(new Resource('awsApigatewayv2Route', this.name + 'Sokt' + phrasing('camel->kamel', lbd.getHandle()), {
          apiId:    soktApi.ref('id'),
          routeKey: key,
          target:   `integrations/${tf.embed(integration.refStr('id'))}`
        }));
        void route;
        
        const permission = addPetal(new Resource('awsLambdaPermission', this.name + 'Sokt' + phrasing('camel->kamel', lbd.getHandle()), {
          statementId:  `${ctx.pfx}-${this.name}-${phrasing('camel->kebab', lbd.getHandle())}`,
          action:       'lambda:InvokeFunction',
          functionName: lbd.ref('functionName'),
          principal:    'apigateway.amazonaws.com',
          sourceArn:    `${tf.embed(soktApi.refStr('executionArn'))}/*/*`
        }));
        void permission;
        
      }),
      ...this.managers[map](async ({ lambda }) => {
        
        const lbdEnts = await lambda.getPetals(ctx);
        for (const ent of lbdEnts) addPetal(ent);
        
        const tfIamRole = lambda.getRolePetal(ctx);
        
        const lambdaPolicyName = phrasing('parts->camel', [ 'lambdaApiGwManage', lambda.getName(), this.name ]);
        const lambdaPolicy = addPetal(new Resource('awsIamPolicy', lambdaPolicyName, {
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
          role:      tfIamRole.ref('name'),
          policyArn: lambdaPolicy.ref('arn')
        }));
        void lambdaPolicyAttachment;
        
      })
    ]);
    void lambdaTfEntities;
    
    const hostedZone = this.domain.getHostedZone();
    
    // Cloudfront distribution setup - these resources are always in us-east-1 (motivated by the
    // need to provide cloudfront with a certificate provisioned in us-east-1; it's easier to just
    // provision everything in us-east-1 instead of have cross-region dependencies)
    // Note us-east-1 cloudfront resources link back to resources in `ctx.region` via cloudfront's
    // origin domain name!
    const domainHandle = `domainUse1${this.domain.getNamePcs()[map](p => phrasing('camel->kamel', p)).join('').replace(/[^a-zA-Z0-9]/g, '')}`;
    
    const cloudfrontDomainCert = addPetal(new Resource('awsAcmCertificate', domainHandle, {
      
      ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
      domainName: this.domain.hasSubdomain()
        ? `${'*.'}${this.domain.getNameBase()}`
        : `${''  }${this.domain.getNameBase()}`, // Consider referencing domain name from hosted zone??
      validationMethod: 'dns'[upper]()
      
    }));
    const cloudfrontDomainDns = addPetal(new Resource('awsRoute53Record', domainHandle, {
      
      ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
      
      // Need to create some dns records to facilitate the validation!
      forEach: `| { for opt in ${cloudfrontDomainCert.refStr('domainValidationOptions')} : opt.${phrasing('camel->snake', 'domainName')} => opt }`,
      zoneId:  hostedZone.ref('zoneId'),
      name:    `| each.value.${phrasing('camel->snake', 'resourceRecordName')}`,
      type:    `| each.value.${phrasing('camel->snake', 'resourceRecordType')}`,
      records: `| [ each.value.${phrasing('camel->snake', 'resourceRecordValue')} ]`,
      ttl:     60 * 5
      
    }));
    const cloudfrontDomainValidation = addPetal(new Resource('awsAcmCertificateValidation', domainHandle, {
      
      ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
      
      certificateArn:        cloudfrontDomainCert.ref('arn'),
      validationRecordFqdns: `| [ for rec in ${cloudfrontDomainDns.refStr()} : rec.fqdn ]`
      
    }));
    
    // Redirect http->https; note that http->https redirection is coupled with caching config, as
    // both are facilitated by cloudfront
    const firewall = addPetal(new Resource('awsWafv2WebAcl', this.name, {
      
      ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
      
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
    
    // A single request policy for sokt, and an arbitrary number for http (as each http endpoint
    // can support different allowed-header configurations)
    const routeOrps = this.httpRoutes.filter(r => r.args?.acceptHeaders.length)[map]((route, n) => {
      const headers = route.args!.acceptHeaders;
      return {
        path: route.path,
        method: route.method,
        originRequestPolicy: addPetal(new Resource('awsCloudfrontOriginRequestPolicy', `${this.name}Orp${n}`, /* "origin request policy" */ {
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
    
    const lbdEdge = new LambdaEdge({
      
      name:      `${this.name}SoktEdgeFn`,
      memoryMb:  100,
      localData: {},
      codec:     getLambdaEdgeCodec(), // { type: 'rec', props: { z: { type: 'num' } } } as const,
      baseUrl:   import.meta.url,
      launchFn:  ctx => null,
      env:       {},
      
      invokeFn: args => ({
        // Simply transform the uri
        ...args.shapeData,
        uri: args.args.uri.replace('/api/websocket', '') || '/'
      })
      
    });
    
    const lambdaPetal = (await lbdEdge.getPetals(ctx)).find(p => p.getType() === 'awsLambdaFunction')!;
    
    const baseCacheConfigHttp = addPetal(new Resource('awsCloudfrontCachePolicy', this.name, {
      
      ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
      name: `${ctx.pfx}-${this.name}CacheConfig`,
      
      // Consider setting up caching!! (Requires increasing these values, and sending caching
      // headers from lambdas)
      defaultTtl: 0,
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
    const baseOriginRequestPolicyHttp = addPetal(new Resource('awsCloudfrontOriginRequestPolicy', `${this.name}OrpBase`, {
      name:                `${ctx.pfx}-${this.name}OrpBase`,
      $headersConfig:      { headerBehavior:      'none' },
      $cookiesConfig:      { cookieBehavior:      'all' },
      $queryStringsConfig: { queryStringBehavior: 'all' }
    }));
    const cloudfront = addPetal(new Resource('awsCloudfrontDistribution', this.name, {
      
      ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
      
      // Redirect settings
      aliases: [ this.domain.getNameFull() ],
      
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
      comment: 'cloudfront',
      priceClass: 'PriceClass_100', // cheapest - only pushes to cheap edge locations (e.g. us, ca)
      enabled: true,
      isIpv6Enabled: true,
      defaultRootObject: '',
      
      // Redirect "/api/websocket" requests to sokt origin
      $orderedCacheBehavior$0: {
        pathPattern: '/api/websocket',
        targetOriginId: 'soktApi',
        allowedMethods: 'head,get'[upper]().split(','),
        cachedMethods: 'head,get'[upper]().split(','),
        
        cachePolicyId: addPetal(new Resource('awsCloudfrontCachePolicy', `${this.name}Sokt`, {
          
          ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
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
        
        originRequestPolicyId: addPetal(new Resource('awsCloudfrontOriginRequestPolicy', `${this.name}OrpSokt`, {
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
          // Consider forwarding cookies and query strings?? (TODO: How to get Token1Body???)
          $cookiesConfig:      { cookieBehavior:      'all' },
          $queryStringsConfig: { queryStringBehavior: 'all' }
        })).ref('id'),
        
        viewerProtocolPolicy:  'redirect-to-https',
        
        $lambdaFunctionAssociation: {
          eventType: 'origin-request',
          lambdaArn: lambdaPetal.ref('qualifiedArn'),
          includeBody: false
        }
      },
      
      ...(routeOrps[cl.toObj](({ path, method, originRequestPolicy }, n) => {
        
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
            options:   'head,get,options',
          }[cl.at](method, 'head,delete,post,get,options,put,patch')[upper]().split(','),
          
          // Here we specify caching for some methods, but whether this actually takes effect
          // depends on http headers returned by the specific endpoint! 
          cachedMethods:         'head,get,options'[upper]().split(','),
          targetOriginId:        'httpApi',
          cachePolicyId:         baseCacheConfigHttp.ref('id'), // Base caching simply means "headers: no, cookies: no, query string: yes"
          originRequestPolicyId: originRequestPolicy.ref('id'), // This cache-behaviour-specific orp mostly whitelists headers
          viewerProtocolPolicy:  'redirect-to-https'
        }];
        
      })),
      
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
      
      $viewerCertificate: {
        acmCertificateArn: cloudfrontDomainCert.ref('arn'),
        sslSupportMethod: phrasing('camel->kebab', 'sniOnly'), // "server name indication"; the client always mentions the hostname they're connecting to; this says to use that mentioned hostname to determine the cert (multiple hostnames may exist under the same cloudfront/ip address)
        minimumProtocolVersion: 'TLSv1.2_2019'
      },
      
      webAclId: firewall.ref('arn'), // Yes... "arn", not "id"
      
      dependsOn: [ cloudfrontDomainValidation.ref() ]
      
    }));
    
    // Add a log group for cloudfront... FOR EVERY REGION... OOWOWWWWWW
    for (const region of awsRegions)
      addPetal(new Resource('awsCloudwatchLogGroup', `${this.name}Logs${phrasing('camel->kamel', region.mini)}`, {
        ...tf.provider(ctx.soil.getRegion(), region.term),
        name: `/aws/cloudfront/LambdaEdge/${tf.embed(cloudfront.refStr('id'))}`,
        retentionInDays: 14
      }));
    
    // Connect our domain name as an entrypoint to cloudfront
    const cloudfrontDns = addPetal(new Resource('awsRoute53Record', this.name, {
      
      // Define the given domain name as an alias for cloudfront's address!
      // Note this form of "a" record is unique to aws - it points a domain to another domain,
      // whereas typical "a" records point an ip address to a domain.
      
      ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
      zoneId: hostedZone.ref('id'),
      name: this.domain.getNameFull(),
      type: 'a'[upper](),
      
      $alias: {
        name:                 cloudfront.ref('domainName'),
        zoneId:               cloudfront.ref('hostedZoneId'),
        evaluateTargetHealth: false
      }
      
    }));
    void cloudfrontDns
    
    return [ ...petals ];
    
  }
};