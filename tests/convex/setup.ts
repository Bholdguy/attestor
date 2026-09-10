// convex-test needs a glob of all backend modules (it can't read the filesystem
// the way the real deployment bundler does). Exclude *.test.ts.
export const modules = import.meta.glob("../../convex/**/!(*.test).*s");
