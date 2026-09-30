/** Thrown by Phase 0 stubs. Implementation agents replace every call site in their package. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = "NotImplementedError";
  }
}
