import { labRun, err, type Env } from "../../../../../packages/lab/src/http.ts";
export const onRequestPost: PagesFunction<Env> = ({ request, env, waitUntil }) => labRun(request, env, waitUntil);
export const onRequest: PagesFunction<Env> = () => err("use POST", 405, "method_not_allowed");
