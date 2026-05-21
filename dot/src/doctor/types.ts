/** Severity level for a single check result */
export type Severity = "ok" | "warn" | "error";

/** A single check outcome */
export interface CheckResult {
  readonly severity: Severity;
  readonly message: string;
  /** Extra context (e.g. expected vs actual, fix command) */
  readonly detail?: string;
}

/** A named group of check results */
export interface CheckSection {
  readonly name: string;
  readonly results: readonly CheckResult[];
}

/** Full doctor report aggregating all sections */
export interface DoctorReport {
  readonly sections: readonly CheckSection[];
  readonly warnings: number;
  readonly errors: number;
  readonly timestamp: number;
}
