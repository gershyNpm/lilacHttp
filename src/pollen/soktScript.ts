import type { NetProc } from '@gershy/util-http';
import type { JsfnInstSer } from '@gershy/util-jsfn-encode';

export class SoktScript {
  
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
      form: this.constructor as typeof SoktScript,
      args: [ { netProc, key } ]
    } satisfies JsfnInstSer<typeof SoktScript>;
    
  }
  
};