import { labRuns, err, type Env } from "../../../../../packages/lab/src/http.ts";
export const onRequestGet: PagesFunction<Env> = ({ env, request }) => labRuns(env, new URL(request.url));
export const onRequest: PagesFunction<Env> = () => err("use GET", 405, "method_not_allowed");
