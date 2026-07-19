import http from '@gershy/util-http';
import type { JsfnInstSer } from '@gershy/util-jsfn-encode';
import type { HttpReq, HttpRes } from '@gershy/util-http';
import type { ServiceMap } from '@gershy/lilac';

// TODO: `soil` should not be connected to "region" - it should be possible to plant Flowers across
// different regions but within the same soil!!

type HttpHandlerArgs = {
  context?:   { progressiveServiceMap: ServiceMap },
  serviceId:  string
};

export class HttpCaller<Req extends HttpReq, Res extends HttpRes> {
  
  // Represents an http handler, which is addressable via a url and returns
  
  protected context:      null | { progressiveServiceMap: ServiceMap };
  protected serviceId: HttpHandlerArgs['serviceId'];
  constructor(args: HttpHandlerArgs) {
    this.context = args.context ?? null;
    this.serviceId = args.serviceId;
  }
  
  protected resolveHttpService() {
    
    const serviceMap: ServiceMap = this.context?.progressiveServiceMap ?? process[Symbol.for('@gershy/lilac/serviceMap')] ?? {};
    const svc = serviceMap[cl.at](this.serviceId, null);
    
    if (!svc && this.serviceId[cl.hasHead]('domain/')) {
      // Can still resolve domains despite the ServiceMap lacking an entry - will just lack some defaults
      const addr = this.serviceId.split('/')[1];
      return { addr };
    }
    
    if (!svc) throw Error('http unresolvable')[cl.mod]({ serviceId: this.serviceId, serviceMap });
    
    return svc;
    
  }
  
  // TODO: This method's typing needs to become a lot more sophisticated
  // - Req:     the overall type that needs to be satisfied to make a request
  // - Res:     the overall type returned by the http caller
  // - BaseReq: the type already present to make the request
  public send(args: (Req extends { query: any } ? { query: Req['query'] } : {}) & (Req extends { body: any } ? { body: Req['body'] } : any) & { path?: string[], method?: string, port?: number }): Promise<Res> {
    
    const svc = this.resolveHttpService();
    
    // TODO: This argument merging/extension needs to become "first-class"
    const addr = svc.addr;
    const port = args.port ?? svc.port ?? 443;
    const method = args.method ?? 'get';
    const path = [ ...(svc.http?.path ?? []), ...(args.path ?? []) ];
    
    return http({
      $req:    null as any,
      $res:    null as any,
      netProc: { proto: port === 443 ? 'https' : 'http', addr, port },
      path,
      method
    }, args as any) as any as Promise<Res>;
    
  }
  
  toJsfn() {
    const context = this.context?.[cl.slice]([ 'progressiveServiceMap' ]) ?? null;
    const { serviceId } = this;
    return {
      hoist: `${import.meta.dirname}::{${this.constructor.name}}` as const,
      form: this.constructor as typeof HttpCaller<Req, Res>,
      args: [ { ...(context && { context }), serviceId } ]
    } satisfies JsfnInstSer<typeof HttpCaller<Req, Res>>;
  }
  
};
