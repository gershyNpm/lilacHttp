import { assertEqual, testRunner } from '../build/utils.test.ts';
import './main.ts';

// Type testing
(async () => {
  
  type Enforce<Provided, Expected extends Provided> = { provided: Provided, expected: Expected };
  
  type Tests = {
    1: Enforce<{ x: 'y' }, { x: 'y' }>,
  };
  if (0) ((v?: Tests) => void 0)();
  
})();

testRunner([
  
  { name: 'not implemented', fn: async () => {
    
    // TODO: HEEERE0
    // - Need heavy test for aws (not localstack):
    //    - IDEALLY: ephemeral, isolated aws org (created+deleted in the test's lifecycle)
    //    - Test WAF, CF, and L@E via *webhook*
    //    - If a webhook test can pass with WAF+CF in play we are soooo good to go
    //    - More various pollen tests, e.g. lambda write item to db with iam perms etc.
    //    - And then will want to focus on ECS Flower, maybe spacetimedb? Maybe a cool game??
    
    // TODO: Implement!
    assertEqual(null, null);
    
  }}
  
]);