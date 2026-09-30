// DATA_DIR is only known at runtime; turbopackIgnore on the fs calls stops the build from tracing the whole repo.
export const dataDir = () => process.env.DATA_DIR || "/data";
