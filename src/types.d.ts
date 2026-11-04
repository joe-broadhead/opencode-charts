// d3-format ships no types; this plugin uses one function of it (a dependency of Vega, bundled with it).
declare module "d3-format" {
  export function formatLocale(definition: unknown): { format: (specifier: string) => (n: number) => string }
}
