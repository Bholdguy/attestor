// Frontend type mirror. The frontend imports TYPES ONLY from the product
// contract — it never re-implements a validator (ARCHITECTURE §9). These are
// erased at build time, so `src/` carries no runtime dependency on `convex/`.
export type {
  StatusNormalized,
  PrivilegeType,
  ExtractionConfidence,
  FetchStatus,
  Disposition,
  SourceMode,
  CaseType,
  ConflictKind,
  MatchConfidence,
  IdentityMismatchReason,
  PrivilegeReason,
  CaseResolutionState,
  AuditStage,
  ExtractedFields,
  ConflictEntry,
  DiffResult,
  IdentityResult,
  PrivilegeResult,
  CaseDetail,
} from "../../convex/contract";

export type { Badge } from "../../convex/badge";
