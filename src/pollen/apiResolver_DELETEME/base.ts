import type { Soil } from '@gershy/lilac';
import type { HttpCaller } from '../httpCaller.ts';
// import type { HttpReq, HttpRes, NetProc } from '@gershy/util-http';

// export type ApiResolver<Req extends HttpReq, Res extends HttpRes> = {
//   resolveApi(soil: Soil.Base): Promise<{ netProc: NetProc, path: string[] }>;
// };
export type ApiResolver = {
  resolveApi(soil: Soil.Base): Promise<HttpCaller<any, any>>
};