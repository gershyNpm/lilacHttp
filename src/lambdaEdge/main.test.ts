import { rootFact, tempFact } from '@gershy/disk';
import { assertEqual, testRunner } from '../../build/utils.test.ts';
import './main.ts';
import { LambdaEdge } from './main.ts';
import Logger from '@gershy/logger';
import codecParse from '@gershy/util-codec-parse';
import type { AnyLambda } from '@gershy/lilac-lambda';

// Type testing
(async () => {
  
  type Enforce<Provided, Expected extends Provided> = { provided: Provided, expected: Expected };
  
  type Tests = {
    1: Enforce<{ x: 'y' }, { x: 'y' }>,
  };
  if (0) ((v?: Tests) => void 0)();
  
})();

const getLambdaInvokeFn = async <Lbd extends AnyLambda>(lbd: Lbd) => {
  
  // TODO: This harness to extract and execute a lambda's generated javascript already repeats
  // here and in lilacLambdaHttp - consider a shared helper??
  
  const script = await lbd.getScript({
    ctx: {
      name:      'test',
      logger:    new Logger('test'),
      fact:      rootFact.kid([ import.meta.dirname, 'infra' ]),
      patioFact: rootFact.kid([ import.meta.dirname, 'infra', 'patio' ]),
      shedFact:  tempFact.kid([ '@gershy' ]),
      
      maturity: 'm0',
      debug: true,
      pfx: 'test'
    },
    lang: 'js'
  });
  
  const require = (term: string) => {
    if (term === '@gershy/clearing') return null;
    if (term === '@gershy/logger') return { default: function() { return Logger.dummy; } }; // Silence lambda logs
    if (term === '@gershy/util-codec-parse') return { default: codecParse };
    throw Error('mock require unaware')[cl.mod]({ term });
  };
  const invoke = eval(String[cl.baseline](`
    | (({ require }) => {
    |   
    |   const module = { exports: {} };
    |   
    ${script[cl.indent]('|   ')}
    |   
    |   return module.exports.handler;
    |   
    | })
  `))({ require });
  
  return invoke as (req: any, ctx: any) => any;
  
};

testRunner([
  
  { name: 'sourcecode gen', fn: async () => {
    
    // Instantiates a `JsfnUtility` instance with `a = 'util'`, and takes an http body param `b`,
    // which is a number, to call `JsfnUtility.prototype.helperFn`, which returns `a.repeat(b)`
    const lbd = new LambdaEdge({
      name: 'myLbd',
      baseUrl: import.meta.url,
      memoryMb: 128,
      localData: { z: 'hi' },
      codec: { type: 'rec', loose: true, props: {} } as const,
      launchFn: args => ({}),
      invokeFn: ({ launchData, args }) => ({ uri: '/overwritten/path' }),
      env: {}
    });
    
    const invoke = await getLambdaInvokeFn(lbd);
    
    const shapeData = {
      ctx: {
        callbackWaitsForEmptyEventLoop: false,
        clientContext:                  {},
        invokedFunctionArn:             'invoked-function-arn',
        awsRequestId:                   'aws-request-id',
        getRemainingTimeInMillis:       () => 1000 * 60 * 10
      },
      req: {
        Records: [
          {
            cf: {
              request: {
                headers: {
                  'test-header-0': [ 'a', 'b', 'c' ],
                  'test-header-1': [ 'd', 'e', 'f' ],
                },
                uri: '/native/aws/path'
              }
            }
          }
        ]
      }
    };
    const res = await invoke(shapeData.req, shapeData.ctx);
    
    assertEqual(res, { headers: {}, uri: '/overwritten/path' });
    
  }},
  
]);