// Types for scripts/notices.mjs, imported by test/unit/notice.test.ts.
export interface NoticedPackage {
  name: string
  version: string
  license: string
  dir: string
  repo: string
}
export interface Licence {
  file: string
  target: string
  text: string
  note: string
  copied: boolean
}
export const NOTICE_DESIGN_HEADING: string
export function packageAt(dir: string): NoticedPackage
export function collectPackages(root: string, inputs: Iterable<string>): NoticedPackage[]
export function licenceFor(root: string, pkg: NoticedPackage): Licence
export function writeLicenceFiles(root: string, packages: NoticedPackage[]): void
export function thirdPartyNotices(root: string, packages: NoticedPackage[]): string
export function notice(existing: string, root: string, packages: NoticedPackage[]): string
