import type { Json } from "../engines/common.js"
import { recommend } from "../recommend/rank.js"
import type { ToolEnvironment } from "../tools.js"

/** tools.charts.recommend: a ranked shortlist with reasons, encodings and ready calls. It never renders. */
export async function runRecommend(env: ToolEnvironment, input: Record<string, unknown>): Promise<Json> {
  if ((input.data as { path?: string } | undefined)?.path) await env.assertFiles("read", [(input.data as { path: string }).path])
  const outcome = await recommend(input as never, env)
  return outcome.result as unknown as Json
}
