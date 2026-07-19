import { assertEqual, cmpAny, testRunner } from '../build/utils.test.ts';
import './main.ts';
import lambdaEdgeTests from './lambdaEdge/main.test.ts';
import codecParse from '@gershy/util-codec-parse';
import awsRegions from './util/awsRegions.ts';
import { getRootLogger } from '@gershy/entry';
import phrasing from '@gershy/util-phrasing';
import { Fact, rootFact, tempFact } from '@gershy/disk';
import { Garden, SeedBank, Soil, type Context as LilacContext, type ServiceMap } from '@gershy/lilac';
import { LambdaHttp } from '@gershy/lilac-lambda-http';
import { HttpGateway } from './main.ts';
import { Domain } from '@gershy/lilac-domain';
import { HttpCaller } from './pollen/httpCaller.ts';

// Type testing
(async () => {
  
  type Enforce<Provided, Expected extends Provided> = { provided: Provided, expected: Expected };
  
  type Tests = {
    1: Enforce<{ x: 'y' }, { x: 'y' }>,
  };
  if (0) ((v?: Tests) => void 0)();
  
})();

const logger = getRootLogger({ name: 'test', maxLineLen: 200, objDepth: 5, ansi: true });
const testFact = rootFact.kid([ import.meta.dirname, '.test' ]);

const inputArgs = (() => {
  
  const args = eval(`(${ process.argv.find(v => v[0] === '{') ?? '{}' })`);
  const effort: Effort = args[cl.at]('effort', 0);
  
  const awsCredsCodec = {
    
    type: 'rec',
    loose: true,
    props: {
      region: { type: 'enum', opts: awsRegions.map(v => v.term) },
      auth: { type: 'rec', loose: true, props: {
        id: { type: 'str' },
        '!secret': { type: 'str' }
      }}
    }
    
  } as const;
  
  const aws = cl.safe(() => codecParse(awsCredsCodec, args.aws), err => logger.log({ err }));
  return { effort, aws };
  
})();

type Effort = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type AwsCloudTestArgs = {
  term: string,
  effort: Effort,
  fn: (args: { term: string, fact: Fact, context: LilacContext }) => Promise<{
    seedBank: SeedBank<any>,
    garden: Garden<any>,
    fn: (args: { output: any, soil: Soil.AwsCloud }) => Promise<void>
  }>
};
const awsCloudTest = (args: AwsCloudTestArgs) => ({ name: phrasing('camel->parts', args.term).join(' '), fn: async () => {
  
  await logger.scope(`awsCloud.${args.term}`, {}, async logger => {
    
    const { term, effort, fn } = args;
    
    if (inputArgs.effort < effort) return void console.log(`Skipping test - effort (min: ${args.effort}, got: ${inputArgs.effort})`);
    if (!inputArgs.aws)            return void console.log(`Skipping test - aws creds missing`);
    
    const fact = testFact.kid([ term ]);
    const context: LilacContext = {
      name:      term,
      fact:      fact.kid([ 'terraform' ]),
      patioFact: fact.kid([ 'patio' ]),
      shedFact:  tempFact.kid([ '@gershy' ]),
      logger:    logger.kid('garden'),
      maturity:  'm0',
      debug:     false,
      pfx:       phrasing('camel->kebab', term),
      
      progressiveServiceMap: {}
    };
    
    const { seedBank: seedBank, garden, fn: followupFn } = await fn({ term, fact, context });
    const soil = new Soil.AwsCloud({ logger, seedBank, aws: inputArgs.aws });
    const { output, rake } = await garden.grow({ type: 'real', soil });
    
    try {
      
      await followupFn({ output, soil });
      
    } finally {
      
      await rake().catch(err => {
        throw err[cl.mod](msg => ({ msg: `${msg} - aws deployment couldn't be removed; see tfFp`, tfFp: fact.fsp() }));
      });
      
      await fact.rem();
      
    }
    
  });
  
}});

testRunner([
  
  ...lambdaEdgeTests,
  
  // TODO: HEEERE0
  // - Need heavy test for aws (not localstack):
  //    - IDEALLY: ephemeral, isolated aws org (created+deleted in the test's lifecycle)
  //    - Test WAF, CF, and L@E via *webhook*
  //    - If a webhook test can pass with WAF+CF in play we are soooo good to go
  //    - More various pollen tests, e.g. lambda write item to db with iam perms etc.
  //    - And then will want to focus on ECS Flower, maybe spacetimedb? Maybe a cool game??
  // - What about ACM cert??? Initial terraform must omit it (as terraform will hang while the dns
  //   lookup doesn't resolve), then user adds it, then user flips a flag in the code, then all is
  //   good??
  
  // 1. apigwCdnNoSoktNo
  // 3. apigwCdnYaSoktNo
  // 2. apigwCdnNoSoktYa
  // 4. apigwCdnYaSoktYa
  // ... anndddddd... no domain tests at all??? maybe some kinda manual harness???
  
  { name: 'basic', fn: async () => {
    
    const soil = {
      getRegion: () => 'ca-central-1'
    } as any;
    const context = {
      pfx: 'httpbasictest'
    } as any;
    
    const httpGw = new HttpGateway({
      soil, context,
      name:       'testy',
      domain:     1 ? undefined : new Domain({ proto: 'https', addr: 'test.org', port: 443 }),
      throttling: { requestsPerIpPerMin: 300 },
      enableCdn:  false
    });
    
    const tf = await httpGw.getPetals()
      .then(petals => Promise.all(petals.map(p => p.getResult())))
      .then(tfs => tfs.map(tf => cl.isCls(tf, String) ? { tf } : tf))
      .then(result => result[cl.map](r => r.tf.trim() || cl.skip).join('\n'));
    
    assertEqual(
      tf,
      String[cl.baseline](`
        | resource "aws_apigatewayv2_api" "testy_hgw_http" {
        |   name = "httpbasictest-testy"
        |   protocol_type = "HTTP"
        | }
        | resource "aws_apigatewayv2_stage" "testy_hgw_http" {
        |   api_id = aws_apigatewayv2_api.testy_hgw_http.id
        |   name = "httpbasictest-testy-http"
        |   auto_deploy = true
        |   stage_variables = {}
        | }
        | resource "aws_apigatewayv2_api" "testy_hgw_sokt" {
        |   name = "httpbasictest-testy-sokt"
        |   protocol_type = "WEBSOCKET"
        | }
        | resource "aws_apigatewayv2_stage" "testy_hgw_sokt" {
        |   api_id = aws_apigatewayv2_api.testy_hgw_sokt.id
        |   name = "httpbasictest-testy-sokt"
        |   auto_deploy = true
        | }
        | output "testy_output" {
        |   value = {
        |     addr = aws_apigatewayv2_api.testy_hgw_http.api_endpoint
        |     stage_name = aws_apigatewayv2_stage.testy_hgw_http.name
        |   }
        |   description = "<no desc>"
        |   sensitive = false
        | }
      `)
    );
    
  }},
  
  awsCloudTest({ term: 'apigwCdnNoSoktNo', effort: 3, fn: async args => {
    
    const { context } = args;
    
    const seedBank = new SeedBank({
      Domain: { real: Domain, test: Domain },
      LambdaHttp: { real: LambdaHttp, test: LambdaHttp },
      HttpGateway: { real: HttpGateway, test: HttpGateway },
    });
    
    const garden = new Garden({ context, seedBank, define: function*(ctx, seedBank) {
      
      const { HttpGateway, LambdaHttp, Domain } = seedBank;
      const httpGw = new HttpGateway({
        name:       'testy',
        domain:     1 ? undefined : new Domain({ proto: 'https', addr: 'test.org', port: 443 }),
        throttling: { requestsPerIpPerMin: 300 },
        enableCdn:  false
      });
      const pingApi = httpGw.addHttpScript('/ping -> get', {}, new LambdaHttp({
        name:      'ping',
        memoryMb:  1000,
        localData: {},
        codec:     { type: 'rec', loose: true, props: {} } as const,
        baseUrl:   import.meta.url,
        launchFn:  (args) => ({}),
        invokeFn:  () => ({ code: 200, body: { msg: 'pong' } }),
        env:       {}
      }));
      void pingApi;
      
      yield httpGw;
      
    }});
    
    return { seedBank, garden, fn: async ({ output }) => {
      
      const serviceMap: ServiceMap = output[cl.at]('serviceMap', {});
      
      const caller = new HttpCaller({
        context: { progressiveServiceMap: serviceMap },
        serviceId: `apiGw/ca-central-1/${context.pfx}-testy`
      });
      
      const res = await caller.send({ path: [ 'ping' ], method: 'get' }).catch(err => {
        
        logger.log({ $$: 'testHttpReject', err });
        return null;
        
      });
      
      assertEqual(res, { reqArgs: cmpAny, code: 200, body: { msg: 'pong' } });
      
    }};
    
  }}),
  
  awsCloudTest({ term: 'apigwCdnYaSoktNo', effort: 4, fn: async args => {
    
    const { context } = args;
    
    const seedBank = new SeedBank({
      Domain: { real: Domain, test: Domain },
      LambdaHttp: { real: LambdaHttp, test: LambdaHttp },
      HttpGateway: { real: HttpGateway, test: HttpGateway },
    });
    
    const garden = new Garden({ context, seedBank, define: function*(ctx, seedBank) {
      
      const { HttpGateway, LambdaHttp, Domain } = seedBank;
      const httpGw = new HttpGateway({
        name:       'testy',
        domain:     1 ? undefined : new Domain({ proto: 'https', addr: 'test.org', port: 443 }),
        throttling: { requestsPerIpPerMin: 300 },
        enableCdn:  true
      });
      const pingApi = httpGw.addHttpScript('/ping -> get', {}, new LambdaHttp({
        name:      'ping',
        memoryMb:  1000,
        localData: {},
        codec:     { type: 'rec', loose: true, props: {} } as const,
        baseUrl:   import.meta.url,
        launchFn:  (args) => ({}),
        invokeFn:  () => ({ code: 200, body: { msg: 'pong' } }),
        env:       {}
      }));
      void pingApi;
      
      yield httpGw;
      
    }});
    
    return { seedBank, garden, fn: async ({ output }) => {
      
      const serviceMap: ServiceMap = output[cl.at]('serviceMap', {});
      
      const caller = new HttpCaller({
        context: { progressiveServiceMap: serviceMap },
        serviceId: `cfDistro/${context.pfx}-testy` // Should the pfx come first??
      });
      
      const res = await caller.send({ path: [ 'ping' ], method: 'get' }).catch(err => {
        
        logger.log({ $$: 'testHttpReject', err });
        return null;
        
      });
      
      assertEqual(res, { reqArgs: cmpAny, code: 200, body: { msg: 'pong' } });
      
    }};
    
  }})
  
]);