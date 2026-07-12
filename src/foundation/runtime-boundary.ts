export interface StaticRuntimeCopyEntry {
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
}

export interface VerificationResult {
  readonly check: string;
  readonly status: "pass" | "fail" | "not-run";
  readonly evidence?: string;
}
