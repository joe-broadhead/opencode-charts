import { RegisterError, refusal } from "@we-the-rebel-alliance/plugin-contract/register"
import { ChartsError } from "../errors.js"

/**
 * A handler's failure as the contract reads it (contract §12).
 *
 * The contract's table is closed: a plugin's own code is not one of its codes, so a Charts failure carries its own code
 * in the sentence and takes the contract's nearest one (`INPUT_INVALID` for a chart request, `TOO_LARGE` for a size
 * limit, `UNAVAILABLE` for a renderer that is not there). The register then formats the one
 * `CODE: What happened. Next step: What to do.` form.
 */
export function contractFailure(error: unknown): never {
  if (error instanceof RegisterError) throw error
  if (error instanceof ChartsError) {
    const code = error.code === "DATA_TOO_LARGE" || error.code === "SPEC_TOO_LARGE" || error.code === "PNG_TOO_LARGE"
      ? "TOO_LARGE"
      : error.code === "HTML_UNAVAILABLE" || error.code === "PNG_UNAVAILABLE"
        ? "UNAVAILABLE"
        : "INPUT_INVALID"
    throw new RegisterError(refusal(code, `${error.code}: ${error.detail}${error.path ? ` (at ${error.path})` : ""}`, error.hint))
  }
  if (error instanceof Error && error.name === "ZodError") {
    throw new RegisterError(refusal("INPUT_INVALID", `The input does not match the method's parameters: ${error.message}`, "Check the method's parameters and call it again."))
  }
  throw error
}
