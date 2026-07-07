import { PetalTerraform, Soil, type Context as LilacContext } from '@gershy/lilac';
import { LambdaBase, type LambdaShape }                       from '@gershy/lilac-lambda';
import * as tf                                                from '../util/terraform.ts';
import awsRegions                                             from '../util/awsRegions.ts';
import phrasing                                               from '@gershy/util-phrasing';
import type { Codec }                                         from '@gershy/util-codec-parse';
import type { Jsfn }                                          from '@gershy/util-jsfn-encode';

// TODO: What's built here is specifically a "request-mapping lambda@edge"!

// Old approach
(() => {
  
  /*
  const name = `${this.name}SoktEdgeFn`;
  const resolvedName = `${ctx.pfx}-${name}`;
  const role = addPetal(new Resource('awsIamRole', name, {
    ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
    name: resolvedName,
    assumeRolePolicy: tf.json(aws.capitalKeys({ version: '2012-10-17', statement: [
      { effect: 'Allow', action: 'sts:AssumeRole', principal: { service: [ 'lambda.amazonaws.com', 'edgelambda.amazonaws.com' ] } },
    ]}))
  }));
  const policy = addPetal(new Resource('awsIamPolicy', name, {
    ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
    name: resolvedName,
    policy: tf.json(aws.capitalKeys({ version: '2012-10-17', statement: [{
      effect: 'Allow',
      action: [ 'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents' ],
      resource: [ `arn:aws:logs:*:*:*` ]
    }]}))
  }));
  const attach = addPetal(new Resource('awsIamRolePolicyAttachment', name, {
    ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
    role:      role.ref('name'),
    policyArn: policy.ref('arn')
  }));
  void attach;
  
  // WATCH OUT!! Setting up lambda@edge is *very* finnicky - and tricky to debug!!!
  // Note the callback style seems *necessary*!!! It's also *possibly* necessary to mutate
  // `req` instead of just doing `cb({ ...req, uri: fixedUri })`.
  //    | type OriginRequest = {
  //    |   headers: { [K: string]: string[] },
  //    |   uri: string
  //    | };
  //    | type OriginRequestEvent = { Records: { cf: { request: OriginRequest } }[] };
  //    | const edgeFn = (e: OriginRequestEvent, ctx: any, cb: (err: any, val: OriginRequest) => void) => {
  //    |   const req = e.Records[0].cf.request;
  //    |   req.uri = req.uri.replace('/api/websocket', '');
  //    |   if (req.uri.length === 0) req.uri = '/';
  //    |   cb(null, req);
  //    | };
  //    | const packedCode2 = `exports.handler=${edgeFn.toString().replace(/\s+/g, ' ')}`;
  const packedCode = String[baseline](`
    | exports.handler = (e, ctx, cb) => {
    |   const req = e.Records[0].cf.request;
    |   req.uri = req.uri.replace('/api/websocket', '') || '/';
    |   cb(null, req);
    | };
  `);
  const jsZip = new JsZip();
  jsZip.file(`${resolvedName}/code.js`, packedCode, { date: new Date(0) });
  const zip = await jsZip.generateAsync({ type: 'nodebuffer', compression: 'deflate'[upper]() }); // TODO: Throttle??
  const zipFile = addPetal(new File(`literal/lambda/${name}.js.zip`, zip));
  // const jsFile  = addPetal(new File(`literal/lambda/${name}.js`, packedCode));
  
  // Got to watch out for edge function log generation. Edge functions may log to a log group
  // of corresponding name, in *any region*!!! Realistically, this means for every lambda@edge,
  // there is a log group for every region. If we want to be able to set retention, we would
  // theoretically need to pre-emptively create a log group in every possible region that any
  // existing edge lambda could log to
  const soktEdgeLambda = addPetal(new Resource('awsLambdaFunction', name, {
    // WATCH OUT - Provider and `publish` are unique to lambda@edge - they're not copied from
    // lambda.ts - and `timeout` is *maximum 5* for edge!
    ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
    publish: true,
    
    functionName:   resolvedName,
    runtime:        Lambda.awsNodeRuntime,
    role:           role.ref('arn'),
    handler:        `${ctx.pfx}-${name}/code.handler`,
    filename:       zipFile.refStr(),
    timeout:        5,
    sourceCodeHash: hash(packedCode), // Careful not to hash the zipped value, which is nondeterministic
    $loggingConfig: {
      logFormat: 'json'[upper]()
    },
    
    // Consider this produces warnings in terraform - but it does effectively prevent new
    // versions being created every time!
    $lifecycle: {
      ignoreChanges: [
        `| ${phrasing('camel->snake', 'version')}`,
        `| ${phrasing('camel->snake', 'qualifiedArn')}`,
        `| ${phrasing('camel->snake', 'qualifiedInvokeArn')}`,
      ]
    }
  }));
  
  
  for (const region of awsRegions)
    addPetal(new Resource('awsCloudwatchLogGroup', `${name}Logs${phrasing('camel->kamel', region.mini)}`, {
      
      // Here's how the log group is connected to its region
      ...tf.provider(ctx.soil.getRegion(), region.term),
      
      // Note the log group name will always include "us-east-1" as cloudfront resources (like
      // lambda@edge) are considered to be provisioned there, even though these resources are
      // replicated globally
      name: `/aws/lambda/us-east-1.${tf.embed(soktEdgeLambda.refStr('functionName'))}`,
      
      retentionInDays: 14,
      
    }));
  
  */
  
});


type OriginRequest = {
  headers: { [K: string]: string[] },
  uri: string
};
type OriginRequestEvent = { Records: { cf: { request: OriginRequest } }[] }; // TODO: Under what circumstances are there multiple Records??
type Assign<A, B> = Omit<A, keyof B> & B;

export type LambdaEdgeShape = LambdaShape & {
  
  ctx: {
    callbackWaitsForEmptyEventLoop: boolean,
    clientContext: unknown,
    invokedFunctionArn: string,
    awsRequestId: string,
    getRemainingTimeInMillis: () => number
  },
  req: OriginRequestEvent,
  res: OriginRequest,
  
};

export const getLambdaEdgeCodec = () => ({
  type: 'rec',
  props: {
    headerArrs: { type: 'map', item: { type: 'arr', item: { type: 'str' } } },
    headers: { type: 'map', item: { type: 'str' } },
    uri: { type: 'str' }
  },
  fn: (rec) => {
    
  }
} as const);
type LambdaEdgeCodec = ReturnType<typeof getLambdaEdgeCodec>;

export class LambdaEdge<
  
  // TODO: Is this `LambdaEdge`? Or `LambdaEdgeHttpRequestRewrite`??
  
  Res extends { headers?: { [K: string]: string | string[] }, uri: string }, // The lambda's particular response
  LocalData extends Jsfn, // Data provided to lambda by project
  LaunchData, // Arbitrary data initialized by lambda on cold-start
  Cdc extends Codec.Rec<any> & LambdaEdgeCodec, // Codec for validating incoming invocation args
  Env extends Obj<string>
  
> extends LambdaBase<LambdaEdgeShape, Res, LocalData, LaunchData, Cdc, Env> {
  
  constructor(args: Assign<ConstructorParameters<typeof LambdaBase<LambdaEdgeShape, Res, LocalData, LaunchData, Cdc, Env>>[0], { timeoutMs?: number, memoryMb?: number }>) {
    
    const defaults = { timeoutMs: 5000, memoryMb: 100 };
    super({ ...defaults, ...args });
    
  }
  
  async computePetals(ctx: LilacContext & { soil: Soil.Base }) {
    
    const petals: PetalTerraform.Base[] = [];
    
    for (const petal of await super.getPetals(ctx))
      petals.push(petal);
    
    const lambdaPetal = petals.find(p => p.getType() === 'awsLambdaFunction')!;
    if (!cl.isCls(lambdaPetal, PetalTerraform.Resource)) throw Error('unexpected');
    lambdaPetal.mergeProps({
      ...tf.provider(ctx.soil.getRegion(), 'us-east-1'),
      publish: true,
      timeout: 5
    });
    
    // Add a log group for lambda@edge... FOR EVERY REGION OWWWW
    // This will ensure lambda@edge logging retention settings in every region!
    // TODO: `awsRegions` are hardcoded here; realistically a user may have unlocked more
    // regions, or aws may have opened new locations, putting the user's real list of aws regions
    // out-of-date. The nasty result of this is that the user may wind up with infinite-retention
    // log groups in obscure regions! Yikes.
    for (const region of awsRegions)
      petals.push(new PetalTerraform.Resource('awsCloudwatchLogGroup', `${this.name}LambdaEdgeLogs${phrasing('camel->kamel', region.mini)}`, {
        
        // Connect this log group to the region
        ...tf.provider(ctx.soil.getRegion(), region.term),
        
        // Note the log group name will always include "us-east-1" as cloudfront resources (like
        // lambda@edge) are considered to be provisioned there, even though these resources are
        // replicated globally
        name: `/aws/lambda/us-east-1.${tf.embed(lambdaPetal.refStr('functionName'))}`,
        
        retentionInDays: 14,
        
      }));
    
    return petals;
    
  }
  
  getGenericCodecFn() {
    
    return () => ({
      type: 'rec',
      props: {
        headerArrs: { type: 'map', item: { type: 'arr', item: { type: 'str' } } },
        headers: { type: 'map', item: { type: 'str' } },
        uri: { type: 'str' }
      }
    } as LambdaEdgeCodec);
    
  }
  getInvokeWrapper() {
    
    type LbdCls = typeof LambdaBase<LambdaEdgeShape, Res, LocalData, LaunchData, Cdc, Env>;
    type LbdInvokeWrapper = ReturnType<InstanceType<LbdCls>['getInvokeWrapper']>;
    
    return (async args => {
      
      const { default: codecParse } = args.jsfnImport('@gershy/util-codec-parse') as typeof import('@gershy/util-codec-parse');
      const { jsfnImport, debug, logger, codec, launchData, shapeData: { ctx, req }, invokeFn } = args;
      
      return logger.scope('invoke', {}, () => {
        
        if (req.Records.length !== 1) throw Error('request cardinality invalid')[cl.mod]({ req });
        
        const req0 = req.Records[0].cf.request;
        const parsedArgs = codecParse(codec, {
          headerArrs: req0.headers,
          headers: req0.headers[cl.map](h => h[0]),
          uri: req0.uri
        });
        
        const invokeRes = invokeFn({ debug, logger, jsfnImport, shapeData: { ctx, req }, launchData, args: parsedArgs });
        
        // It's possibly essential to mutate the actual `req` - will need to be painstakingly
        // tested with a cloudfront deployment...
        return Object.assign(req0, {
          headers: (invokeRes.headers ?? {})[cl.map](v => cl.isCls(v, Array) ? v : [ v ]),
          uri: invokeRes.uri
        });
        
      });
      
    }) satisfies LbdInvokeWrapper;
    
  }
  
};